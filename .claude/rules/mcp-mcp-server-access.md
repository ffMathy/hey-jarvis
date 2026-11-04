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
tunnel. The phone and the watch can carry a **Cloudflare Access service token** for that (their
setting of that name, on the tour's credentials step and the settings screen), sent on the upgrade
request as `CF-Access-Client-Id` and `CF-Access-Client-Secret`. Make it under Zero Trust → Access →
Service Auth, and allow it with a **Service Auth** policy on the application covering `/api/live`.
**Never give `/api/live` a Bypass policy:** the server runs a glance's actions — unlocking a door —
for any socket that names them, so Access is the only lock on them. The headset runs
in a browser, which cannot set a header on a WebSocket, so it either is paired and uses
`/api/paired/live` (see **Pairing a device** below), or gets through on Access's own
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
[Vision Vertical](mcp-vision-vertical.md#vision-vertical)). Nothing else under `/api` is reachable without Access, but `/api/live` and `/api/paired/*`.

**Pairing a device** (`verticals/api/paired-devices.ts`, table `paired_devices` in
`storage/paired-devices.ts`). A browser — the Quest headset's page, or the phone app's web build —
can be paired with this server instead of holding an ElevenLabs key: the server keeps the key and
mints each conversation's credential for it, and the browser keeps a token of the server's own
(`hologram`'s `paired-device.ts` is the client side of all of it). Both pages are on GitHub Pages,
one of `WEB_APP_ORIGINS`.

- **`POST /api/devices` stays behind Access.** The headset's page sends it as a simple request —
  plain text (the device's name), no headers of its own, `credentials: 'include'` — so it has no
  preflight, which would carry no cookie, and Access's `CF_Authorization` cookie goes with it (the
  same cookie, and the same `SameSite=None` setting, as `/api/live` above). It is refused `403` unless
  its `Origin` is one of `WEB_APP_ORIGINS` (GitHub Pages, and the headset's dev server), because a
  browser sends that cookie with a simple cross-site request from any page. It answers `201` with
  `{ id, token }`: 256 random bits, handed over once; only its SHA-256 is stored.
- **`GET /api/devices`** lists them (never with a token) and **`DELETE /api/devices/<id>`** unpairs
  one, so a lost headset is one device revoked rather than the ElevenLabs key.
- **`/api/paired/*` must bypass Access.** `POST /api/paired/conversation` takes
  `Authorization: Bearer <token>` and `{ "transport": "webrtc" | "websocket", "participantName":
  "jarvis-…" }`, and answers `{ token }` or a `wss://` `{ signedUrl }` minted with
  `HEY_JARVIS_ELEVENLABS_API_KEY` on `HEY_JARVIS_ELEVENLABS_AGENT_ID` (never the test agent): `401`
  for a token no paired device has, `400` for a malformed request, `502` when ElevenLabs could not
  start a conversation — with a message for the device to show. The token is the credential, so the
  headset never has to sign in to Access again once it is paired. In Zero Trust → Access →
  Applications, add a self-hosted application for `<your MCP hostname>/api/paired/*` with a single
  **Bypass** policy (include: Everyone); it covers the preflight its `Authorization` header needs,
  and the paired socket below.
- **`/api/paired/live` is the WebSocket API for paired devices** (`PAIRED_LIVE_SOCKET_PATH` in
  `live-socket.ts`): the same frames as `/api/live`, but its hello has to carry the device's token
  (`{"type":"hello","device":"vr","token":"…"}`), which the server checks itself, and a socket
  whose hello does not is closed `4401` — never tried again by the device. Frames sent before the
  check answers are ignored, glance actions included: here the device token is the lock on them
  that Access is on `/api/live`. A paired headset therefore needs no Access cookie for its line,
  which runs out with Access's session. The phone and the watch need no pairing: their service
  token lasts until it is revoked.

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
| server → device | `{"type":"glance","glance":{"id":"…","url":"…","title":"…","generatedAt":"<ISO 8601>","actions":[{"id":"…","label":"…","prompt":"…"}]}}` | The current glance: right after `ready` when there is one, and to every socket whenever a new one is built |
| device → server | `{"type":"glanceAction","requestId":"…","glanceId":"…","actionId":"…"}` | Sir pressed a button on the glance; `requestId` at most 64 characters |
| server → device | `{"type":"glanceActionResult","requestId":"…","ok":true\|false,"message":"…"}` | How that went, to that socket only: Jarvis's answer, or why it was refused |

**No authentication**: the hello names the device, for the log, and is not a credential. A refusal is
a close: `4400` a first frame that is not a hello, `4408` no hello in time; an upgrade past 32
open sockets is answered `503`. A device tries again with a growing delay after anything but `4400`. Frames over a kilobyte close their socket (`1009`), and every socket is pinged
every 30 seconds, which also keeps Cloudflare from closing a quiet one after 100.

After `ready`, a socket is sent every event published on `utils/live-events.ts` — today `affectedEntities` and `agentActivity`, see
[What a request touches](mcp-routing-affected-entities.md#affected-entities), and `glance`, see
[Glance](mcp-visualize-vertical-shortcuts.md#glance). A device acts on the events it cares about and ignores
the rest. What a socket says sir points at is kept until it says otherwise or closes, and written into
the next request routed — see [What sir points at](mcp-routing-pointing.md#pointing).

A `glanceAction` is run only when its `glanceId` is the current glance's and its `actionId` is one of
that glance's actions, so a device can have nothing run but a prompt the server itself planned; one
action runs at a time across every socket, and another pressed meanwhile is refused with `ok: false`.
The runner is handed to `attachLiveSocket` (`runRequest`) by `mcp-server.ts`, so the spec drives it
with a fake.
