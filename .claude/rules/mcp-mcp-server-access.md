---
paths:
  - "mcp/**"
---

# MCP Server Access

> Part of [Jarvis Mastra AI Agents](mcp.md). Paths in it are relative to `mcp/` unless they say otherwise.

The MCP server itself checks no credentials on port 4112. What stands in front of it is the
Cloudflare tunnel and its **Cloudflare Access** application: ElevenLabs and the integration tests
present a service token (`CF-Access-Client-Id` / `CF-Access-Client-Secret`), and a browser signs in
with an identity policy.

**`/api/live` is unauthenticated on the server.** It is the WebSocket API
(`verticals/api/live-socket.ts`) the phone, the watch and the headset keep open for as long as their
apps run; the server checks no credential and sends every live event to any socket that says
hello. Who may reach it is Cloudflare Zero Trust's to decide, in front of the
tunnel. The phone and the watch can carry a JWT for that (their **Server token** setting), sent on
the upgrade request as `Authorization: Bearer <jwt>` and `cf-access-token: <jwt>`. The headset runs
in a browser, which cannot set a header on a WebSocket, so it gets through on Access's own
`CF_Authorization` cookie instead:

1. **Sign in once in Quest Browser.** The headset's page links to `/api/live` on the server
   whenever its line is not connected. Access shows its own login there and sets `CF_Authorization`
   on the server's hostname for the application that covers the socket's path; the server has no
   page at that path, so the tab is done with once the login is.
2. **Let the cookie travel cross-site.** The headset's page is served from GitHub Pages, so its
   socket to the server is a cross-site request, and a cookie goes with it only when it is
   `SameSite=None`. In the Access application's **Settings → Cookie settings**, set **SameSite
   attribute** to **None** (HTTP Only may stay on), and leave **Enable Binding Cookie** off — that
   cookie is `SameSite=Strict`, and with it on Access would refuse the cross-site socket.
3. **Keep the session long enough.** The cookie lasts the application's **session duration**; when
   it runs out, the page offers signing in again.

Quest Browser has to accept a third-party cookie for this, which is not something this repository
can check; if the line never connects after signing in, that is the first thing to look at. **WebSockets** must be on for the zone (Network → WebSockets). The server holds at most 32
sockets at once. See [The WebSocket API](#the-websocket-api).

**`/api/photos/*` must bypass Access**, as `/artifacts/*` must for the visualize vertical's pages
(see [Visualize Vertical](mcp-visualize-vertical-shortcuts.md#visualize-vertical-shortcuts)). The phone asks for a photo slot there
(`POST /api/photos/slots`) and sends the photo there (`PUT /api/photos/<token>`), and it cannot
present an Access service token, so without a bypass Access answers both with its sign-in page, and
the phone tells sir his photo did not reach Jarvis. In Zero Trust → Access → Applications, add a
self-hosted application for `<your MCP hostname>/api/photos/*` with a single **Bypass** policy
(include: Everyone). It covers both routes and every method, which matters because the browser build
sends a CORS preflight (`OPTIONS`) before each.

**Behind the bypass are two checks, and no credential.** Opening a slot needs the id of a
conversation that ElevenLabs, asked with this server's own API key, reports as in progress on
Jarvis's agent; sending the photo needs the slot's token, 128 random bits handed straight to the
phone, good for five minutes and one photo, and claimed before a byte of the body is read (see
[Vision Vertical](mcp-vision-vertical.md#vision-vertical)). Nothing else under `/api` is reachable without Access, but `/api/live`.

**`/webhooks/*` must bypass Access too.** Every webhook is served under it — today only ElevenLabs'
post-call webhook, `/webhooks/elevenlabs/post-call` — so one self-hosted application for
`<your MCP hostname>/webhooks/*` with a single **Bypass** policy covers them all. Each is guarded by its
sender's signature instead: for ElevenLabs, an HMAC signature (see [Fixing Failed ElevenLabs Evaluations](mcp-fixing-failed-elevenlabs-evaluations.md#fixing-failed-elevenlabs-evaluations)).

**Rate-limit the slot endpoint at Cloudflare as well.** The server limits the checks it sends
ElevenLabs per address (an IPv6 /48), 6 a minute, and 30 for the whole process (see **The
live-conversation check** under [Vision Vertical](mcp-vision-vertical.md#vision-vertical)), but each request it turns away
has still crossed the tunnel and woken the Pi. A rate limiting rule turns a flood away at
Cloudflare's edge instead. Neither the rule nor the server's per-address limit stops a stranger who
asks from many addresses at once from spending the process's 30 checks, and turning sir's photos away
while they keep at it; what the limits bound is how much that can cost, on the Pi and on the
ElevenLabs key. On
the zone's **Security rules** page, **Create rule** → **Rate limiting rules**:
- **When incoming requests match**: URI Path equals `/api/photos/slots`.
- **With the same characteristics**: IP.
- **When rate exceeds**: 3 requests per 10 seconds.
- **Then take action**: Block, for 10 seconds.

Those are what the Free plan allows — one rule, matched on the path, counted by IP, over ten seconds —
and they are ample: a phone asks once per tap of the camera button, plus a CORS preflight from the
browser build. A plan with longer periods can match the server instead, 6 requests a minute, and one
that can match on the method can leave the preflights out by adding Request Method equals `POST`.
The path is compared as written, so a request spelled `/API/PHOTOS/SLOTS` is not counted by the rule
— should Access let it through at all — and meets the server's own limit, which counts every
spelling alike.

**Rolling the camera out** takes these steps, in this order:
1. Deploy the MCP server image with the vision vertical, and add the bypass and the rate limiting
   rule above. The startup log should not say `Photo uploads are off`; if it does, it names the
   ElevenLabs variable missing.
2. Redeploy the ElevenLabs agent (`bunx turbo deploy --filter=elevenlabs`), so that its prompt knows
   the phone's photo messages and it has no client tool for the camera. An agent deployed from an
   earlier build of this feature expects to open the camera itself, through a tool this server no
   longer publishes.
3. In the ElevenLabs dashboard, leave nothing on the MCP server's tool approval policy but the two
   tools it publishes, `routePromptWorkflow` and `getNextInstructionsWorkflow`.
4. On the phone, enter this server's `https://` address under **Jarvis server** in the settings.
   Until it has one, the phone offers no camera button.
5. If a 1Password item was created in the `Jarvis` vault for the earlier build's upload key, delete
   it: nothing reads it any more.

## The WebSocket API

Beside the REST routes, the MCP server serves one WebSocket, on the same port, at **`/api/live`**
(`verticals/api/live-socket.ts`). REST is for being asked; this is for what the server has to say
first, and what a device keeps it told of. Each device that is Jarvis — the phone, the watch and the
headset — keeps one open for as long as its app runs, across conversations and between them, through
`connectToServer` in `hologram/src/jarvis-server-link.ts`, and only when it knows the server's
address (the phone's **Jarvis server** setting, handed to the watch with the
credentials, and read by the headset from the storage it shares with the phone's web build).

| Direction | Frame | Meaning |
| --- | --- | --- |
| device → server | `{"type":"hello","device":"phone"\|"watch"\|"vr"}` | The first frame, within 10 seconds |
| server → device | `{"type":"ready"}` | This socket is now sent every live event |
| server → device | `{"type":"affectedEntities","entities":[{"id":"…","name":"…"}]}` | A request's tool just read or changed these |
| server → device | `{"type":"agentActivity","delegationId":"…","agentId":"…","state":"…"}` | Where one of a request's agents has got to |
| device → server | `{"type":"pointing","entity":{"id":"…","name":"…"}}` or `"entity":null` | What sir points at now, or nothing |

**No authentication**: the hello names the device, for the log, and is not a credential. A refusal is
a close: `4400` a first frame that is not a hello, `4408` no hello in time; an upgrade past 32
open sockets is answered `503`. A device tries again with a growing delay after anything but `4400`. Frames over a kilobyte close their socket (`1009`), and every socket is pinged
every 30 seconds, which also keeps Cloudflare from closing a quiet one after 100.

After `ready`, a socket is sent every event published on `utils/live-events.ts` — today `affectedEntities` and `agentActivity`, see
[What a request touches](mcp-routing-affected-entities.md#affected-entities). A device acts on the events it cares about and ignores
the rest. What a socket says sir points at is kept until it says otherwise or closes, and written into
the next request routed — see [What sir points at](mcp-routing-pointing.md#pointing).
