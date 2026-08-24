# Jarvis MCP Server

The AI brain of the Jarvis ecosystem — a Mastra-powered MCP server with specialized agents for home automation, weather, shopping, cooking, and more.

## Quick Start

```bash
bunx turbo serve:all --filter=mcp       # Start Mastra Studio (4111) + MCP server (4112)
bunx turbo serve --filter=mcp           # Start the Mastra API server only (no Studio UI)
bun run --cwd mcp serve:mcp             # Start MCP server only (JWT-authenticated)
bunx turbo test --filter=mcp            # Run tests
bunx turbo e2e --filter=mcp             # Run E2E tests
```

Access the playground at `http://localhost:4111/agents` to test agents, debug tools, and monitor
memory. The Studio UI is served by `mastra dev`, which only `serve:all` starts — the plain `serve`
target runs `mastra/index.ts`, which exposes the API and `/health` but not the Studio routes.

## Verticals

The project is organized by business domain. Each vertical contains its own agents, tools, and workflows:

| Vertical | Purpose |
|----------|---------|
| `api` | Token usage tracking |
| `calendar` | Google Calendar management |
| `coding` | GitHub repo/issue management, requirements gathering |
| `commute` | Travel planning and navigation (Google Maps) |
| `cooking` | Recipe search and meal planning (Valdemarsro) |
| `email` | Gmail search, draft, reply |
| `human-in-the-loop` | Form-based approval workflows |
| `internet-of-things` | Smart home device control (Home Assistant) |
| `notification` | Alerts routed to whoever they are for, over whichever channel reaches them (call, voice announcement, push, SMS, email) |
| `phone` | Phone calls and texts (Twilio/ElevenLabs) |
| `routing` | DAG-based task routing and orchestration |
| `shopping` | Bilka grocery shopping (Danish) |
| `synapse` | IoT state change reactor |
| `todo-list` | Google Tasks management |
| `weather` | OpenWeatherMap forecasting |
| `web-research` | Google Search with citations |

## Key Patterns

- **Factory functions** for all agents, tools, and workflows (`createAgent`, `createTool`, `createWorkflow`)
- **Tool IDs** are always `kebab-case` (e.g., `get-current-weather`)
- **Persistent memory** via LibSQL with semantic vector recall
- **Multi-model**: Gemini Flash (primary), Ollama Qwen3 (local/scheduled tasks)
- **Storage**: Credentials, device state, email state, noise baselines, token usage — all in LibSQL

## Server Endpoints

| Endpoint | Port | Purpose |
|----------|------|---------|
| Mastra Studio (Hono) | 4111 | Agent playground, OpenAPI spec, health check |
| MCP Server (Express) | 4112 | JWT-authenticated MCP endpoint |

## Running on a Raspberry Pi

The server is published as a multi-architecture image, so an always-on host — a Pi, a NAS, a small
server — can run it instead of your laptop. [`docker-compose.yml`](./docker-compose.yml) beside this
file is the whole deployment.

### Before you start

| Requirement | Why |
| --- | --- |
| A **64-bit** OS (Raspberry Pi OS Lite 64-bit, or Ubuntu for Pi) | The image is built for `linux/amd64` and `linux/arm64` only. There is no 32-bit build and there cannot be one — Bun has no 32-bit ARM support. A 32-bit install fails at `docker pull` with a no-matching-manifest error. |
| Docker with the Compose plugin | `curl -fsSL https://get.docker.com \| sh` installs both. Add yourself to the `docker` group and log back in. |
| A 1Password **service account token** | The container resolves every other secret itself, at runtime. |
| Pi 4 or newer, 2 GB RAM or more | Two Bun processes under supervisord, plus a local vector store. |

The image is public, so the Pi needs no registry login.

### Steps

1. **Copy the compose file to the Pi.** Only that one file is needed — the image carries the code.

   ```bash
   mkdir -p ~/hey-jarvis && cd ~/hey-jarvis
   curl -fsSLO https://raw.githubusercontent.com/ffMathy/hey-jarvis/main/mcp/docker-compose.yml
   ```

2. **Create a `.env` file next to it.** Compose reads it automatically.

   ```bash
   cat > .env <<'ENV'
   OP_SERVICE_ACCOUNT_TOKEN=ops_...
   HEY_JARVIS_CLOUDFLARED_TUNNEL_TOKEN=ey...
   ENV
   chmod 600 .env
   ```

   Both values are the ones already in use elsewhere in this repository. If the tunnel runs somewhere
   else, delete the `cloudflared` service from the compose file and omit the second line.

3. **Start it.**

   ```bash
   docker compose up -d
   docker compose logs -f mcp
   ```

   First start pulls about 315 MB compressed and then resolves secrets from 1Password, so give it a
   minute before judging it.

4. **Check that storage is persistent.** This one is worth doing rather than assuming — the server
   prints which directory it chose:

   ```bash
   docker compose logs mcp | grep "storage"
   ```

   You want `📦 Using configured storage directory (from HEY_JARVIS_STORAGE_PATH): /data`. If it says
   `/tmp/mcp` instead, the variable did not take effect and **every restart will silently discard the
   OAuth credentials, device state, e-mail state, noise baselines and token usage**. The usual cause
   is `HEY_JARVIS_STORAGE_PATH` also being defined in `mcp/op.env`, which the 1Password CLI resolves
   over the top of the container's environment — change it there rather than here.

5. **Confirm it is healthy.**

   ```bash
   docker compose ps          # mcp should read (healthy)
   curl -sf http://localhost:4111/health && echo   # Mastra
   curl -sf http://localhost:4112/health && echo   # MCP endpoint
   ```

   The image ships its own health check covering both ports, and the tunnel waits for it before
   starting, so it does not come up in front of a server that is not answering yet.

### What is actually running

`supervisord` supervises two processes, both restarted automatically if they die:

| Process | Port | Purpose |
| --- | --- | --- |
| `mastra dev` | 4111 | Studio UI, API, `/health` |
| `mcp-server.ts` | 4112 | JWT-authenticated MCP endpoint — the one ElevenLabs calls |

Secrets are never written to the Pi. The 1Password CLI lives inside the image and resolves the
`op://` references in `mcp/op.env` at process start, from the service account token. The only
credential on disk is that token, in `.env`.

The `cloudflared` container shares the MCP container's network namespace, so the tunnel's existing
ingress rule — `http://localhost:4112`, configured in the Zero Trust dashboard — keeps meaning the
MCP server without any dashboard change. See the tunnel section below for how public hostnames map
to ports.

### Updating

```bash
# Edit the image tag in docker-compose.yml, then:
docker compose pull && docker compose up -d
```

Tags are pinned deliberately rather than tracking `latest`, so an update is something you choose.
The `mcp-data` volume survives it; nothing is re-authorised.

### If Home Assistant runs on the same Pi

The IoT tools read `HEY_JARVIS_HOME_ASSISTANT_URL` and `HEY_JARVIS_HOME_ASSISTANT_TOKEN` from
1Password. That URL is resolved inside the container, so `localhost` there is the container, not the
Pi — point it at the Pi's LAN address or hostname instead.

There is a second path in the code: if those two are absent but `SUPERVISOR_TOKEN` is present, it
talks to `http://supervisor/core`, which is how a Home Assistant **add-on** reaches Core. That branch
exists and works, but this repository ships no add-on manifest, so nothing installs it that way
today. Running it as a plain container, as above, is the supported route.

### Troubleshooting

| Symptom | Cause |
| --- | --- |
| `no matching manifest for linux/arm/v7` | A 32-bit OS. Check with `dpkg --print-architecture` — it must say `arm64`, not `armhf`. Reinstall with the 64-bit image; there is no workaround. |
| Container restarts every ~40s | The health check is failing. `docker compose logs mcp` — almost always the service account token being wrong or lacking access to the vault. |
| Everything forgotten after a restart | Storage went to `/tmp`. See step 4. |
| ElevenLabs has no tools | The tunnel is down or its hostname points at 4111. `docker compose logs cloudflared`. |

## Reaching Mastra Studio through the Cloudflare tunnel

Studio is normally reached at `http://localhost:4111`. The same UI can be served over the Cloudflare
tunnel when you need it from another machine — a phone, a different desktop, or a browser that is not
on this host.

### How the pieces fit

The tunnel is a **remotely-managed** connector: it authenticates with a token
(`HEY_JARVIS_CLOUDFLARED_TUNNEL_TOKEN`) and receives its routing from Cloudflare, so its ingress
rules live in the Zero Trust dashboard rather than in any file in this repository. Each public
hostname maps to exactly one local port.

By default the tunnel's hostname points at the **MCP server on 4112**, because that is the endpoint
ElevenLabs needs. Studio on 4111 is therefore not reachable until you route a hostname to it.

### Steps

1. **Start both services locally.**

   ```bash
   bunx turbo serve:all --filter=mcp
   ```

   This runs `mastra dev` (Studio + API) on 4111 and the MCP server on 4112 under supervisord.
   `serve` alone is not enough — it starts the API server without the Studio routes.

2. **Route a public hostname to Studio's port.** In Zero Trust → Networks → Tunnels → your tunnel →
   *Public Hostnames*, add a hostname whose service is `http://localhost:4111`. Give Studio its own
   hostname rather than repointing the existing one, or the MCP endpoint on 4112 stops being
   reachable and the ElevenLabs agent loses its tools.

3. **Start the connector.**

   ```bash
   bash ./.scripts/run-with-env.sh elevenlabs/op.env \
     bash -c 'TUNNEL_TOKEN="$HEY_JARVIS_CLOUDFLARED_TUNNEL_TOKEN" cloudflared tunnel --protocol http2 run'
   ```

   Passing the token through `TUNNEL_TOKEN` keeps it out of the process command line, where `ps`
   would otherwise expose it.

4. **Sign in.** Cloudflare Access sits in front of the hostname. A browser is covered by the
   identity policy — you authenticate with your email and Studio loads normally. Service tokens are
   for machine clients such as ElevenLabs and the test suite; a browser does not need them.

### If Studio is served from a different origin

Running `mastra studio` separately (it listens on port 3000) points a local UI at a remote API, which
makes the browser send cross-origin credentialed requests. Those are rejected unless the server
echoes back an explicit origin, so set `MASTRA_STUDIO_BASE_URL` to the origin the browser is using:

```bash
MASTRA_STUDIO_BASE_URL=https://<your-studio-hostname>
```

`getAllowedOrigins()` in `mastra/cors.ts` adds that value to the allow-list. It is not needed when
Studio is served from the same origin as the API — the case in step 2 above, and in the Docker
image — because CORS never applies there.

### Troubleshooting

| Symptom | Cause |
| --- | --- |
| Cloudflare sign-in page instead of Studio | Access policy rejected you. Browser access needs an identity (email) policy; a service-token policy must use the **Service Auth** action (`non_identity`), since an `allow` action still demands an identity. |
| Studio loads, but every agent chat comes back as a Cloudflare `502` | The origin answered a streaming route with `Transfer-Encoding: chunked` twice, and `cloudflared` — a Go HTTP client — refuses that outright. `docker logs <tunnel container>` shows `too many transfer encodings: ["chunked" "chunked"]` against `/api/agents/.../stream` or `/threads/subscribe`. Non-streaming routes are unaffected, which is why the UI itself looks healthy. Guarded on both sides now: `mastra/streaming-headers.ts` stops the application from setting the header, and the image runs Bun ≥ 1.3.10, which no longer duplicates it. |
| `404` on `/agents`, but `/health` works | The API server is running without Studio — use `serve:all`, not `serve`. |
| Tunnel connects but serves the wrong thing | The hostname's ingress points at the other port. 4111 is Studio, 4112 is MCP. |

## Environment

Secrets managed via 1Password CLI. Key variables:

- Google API key (Gemini), OpenWeatherMap API key
- Bilka credentials, Algolia keys
- MCP JWT secret
- OAuth credentials for Google Calendar, Gmail, GitHub, Microsoft

See [AGENTS.md](./AGENTS.md) for development guidelines.
