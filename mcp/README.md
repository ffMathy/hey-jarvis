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
| `presence` | Where the primary user is: in the car, at home, or out |
| `phone` | Phone calls and texts (Twilio/ElevenLabs), contacts (Google People) |
| `reflection` | The assistant's own health: failed runs, failing workflow steps, and the errors Mastra reports about itself |
| `routing` | DAG-based task routing and orchestration |
| `shopping` | Bilka grocery shopping (Danish) |
| `synapse` | IoT state change reactor |
| `todo-list` | Google Tasks management |
| `weather` | OpenWeatherMap forecasting |
| `web-research` | Google Search with citations |

## Key Patterns

- **Factory functions** for all agents, tools, and workflows (`createAgent`, `createTool`, `createWorkflow`)
- **Tool IDs** are always `camelCase`, and the id, the variable and the export key are the same word (e.g. `getCurrentWeather`) — Mastra's `/api/tools` endpoint turns the export keys into the published tool names
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
`op://` references in `mcp/op.env` (and those in `mcp/op.optional.env` that resolve) at process
start, from the service account token. The only credential on disk is that token, in `.env`.

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

#### If you let Watchtower update it instead

Running `ghcr.io/ffmathy/mcp:latest` under [Watchtower](https://containrrr.dev/watchtower/) works,
with two settings that are easy to leave out and expensive when you do:

```bash
docker run -d --name watchtower --restart always \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e WATCHTOWER_SCHEDULE="0 0 * * * *" \
  -e WATCHTOWER_CLEANUP=true \
  -e DOCKER_API_VERSION=1.44 \
  containrrr/watchtower
```

- **`WATCHTOWER_CLEANUP=true`.** Without it, every image Watchtower replaces stays behind untagged.
  This image is about 1.7 GB per release, and anything else on the same host that tracks a moving
  tag adds its own — `open-webui:main` is 6.5 GB a pull. Left to run for seven months on a 117 GB
  card, that filled the disk completely, and the first visible symptom was the MCP server failing
  every tool call with `SQLITE_FULL: database or disk is full`.
- **`DOCKER_API_VERSION=1.44`.** Docker Engine 29 refuses API versions below 1.44, and Watchtower
  1.7.1 asks for 1.25. Without the pin the container crash-loops with `client version 1.25 is too
  old`, and nothing gets updated *or* cleaned up.

Note that with Docker 25 or newer the image layers live under `/var/lib/containerd`, not
`/var/lib/docker`, so `du` on the Docker directory looks innocent while the card is full. `docker
system df` and `docker images -f dangling=true` tell the truth; `docker image prune -a -f` is the
cure.

### If Home Assistant runs on the same Pi

The IoT tools read `HEY_JARVIS_HOME_ASSISTANT_URL` and `HEY_JARVIS_HOME_ASSISTANT_TOKEN` from
1Password. That URL is resolved inside the container, so `localhost` there is the container, not the
Pi — point it at the Pi's LAN address or hostname instead.

There is a second path in the code: if those two are absent but `SUPERVISOR_TOKEN` is present, it
talks to `http://supervisor/core`, which is how a Home Assistant **add-on** reaches Core. That branch
exists and works, but this repository ships no add-on manifest, so nothing installs it that way
today. Running it as a plain container, as above, is the supported route.

### Letting Jarvis code on your Claude subscription

The coding vertical does not call a model API for its sessions. It runs the official Claude Code CLI,
signed in with a token from `claude setup-token`, so the work is billed to your Claude subscription
rather than to an API key. Each session runs inside a [Docker Sandbox](https://docs.docker.com/ai/sandboxes/)
— a microVM with its own filesystem, Docker daemon and egress proxy — so a session that skips
permission prompts cannot reach anything on the host. A sandbox needs KVM and the `sbx` daemon, which
live on the host, so the container reaches the host over SSH and runs `sbx exec` there. The host can
be the Pi itself — which is what the `host.docker.internal` entry in the compose file is for — or any
other machine the container can reach.

The SSH key gets no shell on the host. Its only command is
[`.scripts/claude-code-ssh-command.sh`](./.scripts/claude-code-ssh-command.sh), which sshd runs
whatever the connection asked for. It accepts `start <session id>` or `resume <session id>` and
nothing else, and fixes everything that matters itself: the `jarvis` sandbox, the session's
directory, and the `claude` command line. A compromised container can start Claude Code sessions in
the sandbox, and that is all.

The script also decides for itself whether a session is started or resumed: it resumes when the
session's transcript is in the sandbox, and starts it otherwise, whichever word the connection
used. And it runs one process per session at most. Each takes a lock on
`~/jarvis-sessions/<session id>.lock` in the sandbox first, waiting up to two minutes for a previous
process — one a dropped connection left finishing its turn, say — and exiting with code 75 if it
does not let go. Update `/usr/local/bin/jarvis-claude-code` from step 4 whenever the script changes;
the server still works against an older copy, but without either of those guarantees.

Any 64-bit Linux on bare metal with KVM can run Docker Sandboxes — the Pi 4 and 5 included — but
Docker only publishes packages for Ubuntu 24.04 and newer (and Rocky Linux). The Ubuntu 24.04
package needs glibc 2.39, so it also installs on **Raspberry Pi OS based on Debian 13 (trixie)**,
which has 2.41, but not on one based on Debian 12 (bookworm), which has 2.36; `ldd --version` says
which you have. A sandbox takes up to half the host's memory by default, and a session clones the
repository, installs its dependencies and runs its tests in it, so an 8 GB Pi — or a bigger
machine — is the realistic floor.

1. **Create a user for it, and install Docker Sandboxes.** No `sudo`, and not in the `docker` group
   — only `kvm`. Lingering keeps the sandbox daemon running between SSH connections. Take the newest
   `.deb` from [sbx-releases](https://github.com/docker/sbx-releases/releases) rather than this one.

   ```bash
   sudo adduser --disabled-password --gecos '' jarvis
   sudo usermod -aG kvm jarvis
   sudo loginctl enable-linger jarvis
   wget https://github.com/docker/sbx-releases/releases/download/v0.37.1/DockerSandboxes-linux-arm64-ubuntu2404.deb
   sudo apt install ./DockerSandboxes-linux-arm64-ubuntu2404.deb
   ```

2. **As that user, sign in to Docker, create the sandbox, and give it GitHub.** Every session runs in
   the one sandbox named `jarvis`. The GitHub token needs to clone, push and open pull requests on
   your repositories; the sandbox's proxy hands it to `gh` on the way out, so it never enters the
   sandbox itself. Sessions working on this repository run its tests, so give the sandbox Bun too.

   ```bash
   sudo -iu jarvis
   sbx login
   mkdir -p ~/jarvis-workspace && sbx create --name jarvis claude ~/jarvis-workspace
   sbx secret set -g github
   sbx exec jarvis sh -c 'curl -fsSL https://bun.sh/install | bash'
   ```

3. **Put the rest in 1Password.** In the `Jarvis` vault, create an **SSH Key** item named
   `Claude Code` (let 1Password generate an Ed25519 key) and add two fields to it:

   | Field | Value |
   | --- | --- |
   | `SSH target` | `jarvis@host.docker.internal` — or `jarvis@<host>` for another machine, with `ssh://jarvis@<host>:<port>` for a port other than 22. If the MCP container runs with host networking (`--network host`), use `jarvis@127.0.0.1` instead: there `host.docker.internal` resolves to the `docker0` gateway, and host firewalls commonly drop port 22 on it, so the connection times out |
   | `OAuth token` | what `claude setup-token` prints, run on any machine where you are signed in to Claude Code with your subscription |

4. **Install the forced command, and pin the user to it.** Root owns the script, so the `jarvis`
   user cannot change what it runs. The key's `command=` option forces it for that key, and the
   `sshd` drop-in forces it for every login as `jarvis` — so no other key, and no edit to
   `authorized_keys`, gets a shell either.

   ```bash
   sudo curl -fsSL -o /usr/local/bin/jarvis-claude-code \
     https://raw.githubusercontent.com/ffMathy/hey-jarvis/main/mcp/.scripts/claude-code-ssh-command.sh
   sudo chmod 755 /usr/local/bin/jarvis-claude-code

   sudo tee /etc/ssh/sshd_config.d/jarvis.conf <<'SSHD'
   Match User jarvis
       ForceCommand /usr/local/bin/jarvis-claude-code
       PasswordAuthentication no
       PermitTTY no
       AllowTcpForwarding no
       AllowStreamLocalForwarding no
       AllowAgentForwarding no
       X11Forwarding no
   SSHD
   sudo systemctl reload ssh

   sudo -iu jarvis sh -c 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo "restrict,command=\"/usr/local/bin/jarvis-claude-code\" ssh-ed25519 AAAA..." >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
   ```

   `ssh jarvis@<host> bash` should now answer `jarvis-claude-code: refusing "bash"` and nothing more.

`mcp/op.optional.env` maps all three fields, so the server resolves them like every other secret,
and none of them is written to the Pi outside the container. They are optional on purpose: `op run`
stops at the first reference it cannot resolve, so `run-with-env.sh` checks each optional one first
and leaves out any that does not resolve. Without the `Claude Code` item — or with a field missing
from it — the server starts as usual, the MCP server logs one `Claude Code sessions are not
configured` warning naming the missing variables, and only coding sessions are unavailable.

The subscription token goes to the host on the first line of the SSH connection's input, never on a
command line, and on into the sandbox as `CLAUDE_CODE_OAUTH_TOKEN`. The container pins the host's key the first time it connects, in
`/data/claude-code-known-hosts`; delete that file if the host is reinstalled.

Each session works in `~/jarvis-sessions/<session id>` inside the sandbox. The server keeps track of
its sessions in memory, so after a restart it no longer knows the ones it started — but the
transcripts stay in the sandbox, and any of them can be picked up by hand. Claude Code in the
sandbox is signed in only by the token it is handed, so export it first and pass it on with `-e`,
or the session runs unauthenticated:

```bash
sudo -iu jarvis
read -rs CLAUDE_CODE_OAUTH_TOKEN && export CLAUDE_CODE_OAUTH_TOKEN   # paste the OAuth token
sbx exec -it -e CLAUDE_CODE_OAUTH_TOKEN jarvis sh -c 'cd ~/jarvis-sessions/<id> && flock -w 120 ../<id>.lock claude --resume <id>'
```

The `flock` takes the same lock the forced command does, so a session picked up by hand and one
Jarvis resumes never run at once.

If sessions start failing with `Not authenticated to Docker`, the host's Docker sign-in has expired:
run `sudo -iu jarvis sbx login` from your own account — the `jarvis` user's own SSH logins can only
run the forced command, which is also why the resume above starts from `sudo -iu jarvis`.

If a sandbox will not start on a Pi 5, try the 4 KB-page kernel: the Pi 5's default kernel uses
16 KB pages, and the sandbox's own kernel is built for 4 KB ones. The tell-tale is `sbx diagnose`
warning about `mkfs.erofs` and 16 KB blocks. Add `kernel=kernel8.img` to
`/boot/firmware/config.txt` and reboot.

### Troubleshooting

| Symptom | Cause |
| --- | --- |
| `no matching manifest for linux/arm/v7` | A 32-bit OS. Check with `dpkg --print-architecture` — it must say `arm64`, not `armhf`. Reinstall with the 64-bit image; there is no workaround. |
| `docker compose ps` reads `(unhealthy)` | One of the two ports is not answering. `docker compose logs mcp` — almost always the service account token being wrong or lacking access to the vault. **Docker does not restart a container for this**: a health check reports, it does not act, and `restart: unless-stopped` only fires when the container itself exits. Supervisord restarts the individual process, indefinitely; the container stays up either way. |
| Everything forgotten after a restart | Storage went to `/tmp`. See step 4. |
| ElevenLabs has no tools | The tunnel is down or its hostname points at 4111. `docker compose logs cloudflared`. |
| Studio's hostname answers Cloudflare `502` while ElevenLabs still works | `mastra dev` is not listening on 4111, and only it. The tunnel is plainly up — a connector that had gone would give error `1033`, not a 502 naming the host — so the container is running and 4112 is answering. See [When Studio is down but the MCP endpoint is not](#when-studio-is-down-but-the-mcp-endpoint-is-not). |

### When Studio is down but the MCP endpoint is not

The two processes are supervised separately and fail separately, so this is the normal
shape of a Studio outage: the voice assistant carries on, and only the browser sees it.

```bash
docker compose exec mcp supervisorctl status             # which program is not RUNNING
docker compose logs mcp | grep -i mastra-dev             # and why it went
docker compose exec mcp wget -qO- localhost:4111/health  # Studio — the one in question
docker compose exec mcp wget -qO- localhost:4112/health  # MCP endpoint — expected to pass
```

`docker compose exec mcp supervisorctl restart mastra-dev` brings that one program back
without disturbing 4112. `docker compose restart mcp` restarts both and re-resolves every
secret, which is the one to reach for when the logs point at 1Password.

Supervisord retries each program indefinitely rather than three times, so a Studio that
crashed on the way up comes back by itself — the comment at the top of
[`supervisord.conf`](./supervisord.conf) says why three was enough to lose it for good. A
crash that repeats every time is a real fault, and the logs above say which; retrying keeps
it from being silent, it does not make it work.

**On an image built before this change, `supervisorctl` has no socket to talk to** — the
config shipped no `[unix_http_server]` section, so it answers `no such file` however it is
invoked. There, `docker compose restart mcp` is the whole toolbox, and `docker compose logs
mcp` is where the reason is.

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
