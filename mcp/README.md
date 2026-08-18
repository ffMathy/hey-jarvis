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
| `notification` | Multi-channel alerts (voice, SMS, calls) |
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
| `404` on `/agents`, but `/health` works | The API server is running without Studio — use `serve:all`, not `serve`. |
| Tunnel connects but serves the wrong thing | The hostname's ingress points at the other port. 4111 is Studio, 4112 is MCP. |

## Environment

Secrets managed via 1Password CLI. Key variables:

- Google API key (Gemini), OpenWeatherMap API key
- Bilka credentials, Algolia keys
- MCP JWT secret
- OAuth credentials for Google Calendar, Gmail, GitHub, Microsoft

See [AGENTS.md](./AGENTS.md) for development guidelines.
