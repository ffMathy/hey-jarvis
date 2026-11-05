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

**Every app is paired, and that is the only way in** (see the pairing section below). No app holds
an ElevenLabs key or an Access service token: the server holds the key and starts every
conversation, and each device keeps a token of the server's own. There is no unpaired WebSocket;
the one the apps keep open is `/api/paired/live`, and the server checks its token itself. **WebSockets**
must be on for the zone (Network → WebSockets). The server holds at most 32 sockets at once. See
[The WebSocket API](#the-websocket-api).

**A bypass is a policy whose Action is Bypass.** An **Allow** policy with *Include: Everyone* still
asks for a signed-in identity, so a request without one is sent to Access's login (a `302` to
`<team>.cloudflareaccess.com`, or a `403` for a preflight) and never reaches the server. Each
bypassed path below needs its own self-hosted application with a policy of **Action: Bypass**,
*Include: Everyone*. To see which application answers a path, `POST` to it without signing in: the
`kid` in the login link it redirects to names the application, and a bypassed path answers from the
server itself.

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
[Vision Vertical](mcp-vision-vertical.md#vision-vertical)). Nothing else under `/api` is reachable without Access, but `/api/paired/*`.

**Pairing a device** (`verticals/api/paired-devices.ts`, table `paired_devices` in
`storage/paired-devices.ts`; `hologram`'s `paired-device.ts` is the client side). Every app pairs:
the Quest headset's page and the phone app's web build in the browser, the Android phone through
its browser, and the watch through the phone, whose pairing it is handed and shares — unpairing the
phone unpairs the watch. The server keeps the ElevenLabs key and mints each conversation's credential
for a paired device; the device keeps a token of the server's own.

- **Pairing goes through Access, once.** It is the one request that has to prove who is asking, so
  `/api/devices` stays behind the Access application, and sir signs in there with its identity
  policy. A page that finds the server does not answer offers that sign-in (`serverSignInUrl`, which
  opens `/api/devices` itself), then pairs again.
- **`POST /api/devices`**, from a browser (the headset's page, the phone's web build): a simple
  request — plain text (the device's name), no headers of its own, `credentials: 'include'` — so it
  has no preflight, which would carry no cookie, and Access's `CF_Authorization` cookie goes with it.
  The page is on GitHub Pages, so that is a cross-site request, and the cookie goes only when the
  Access application's **Settings → Cookie settings → SameSite attribute** is **None** (leave
  **Enable Binding Cookie** off: that cookie is `SameSite=Strict`). The browser has to accept a
  third-party cookie for it. It is refused `403` unless its `Origin` is one of `WEB_APP_ORIGINS`
  (GitHub Pages, and the headset's dev server), because a browser sends that cookie with a simple
  cross-site request from any page. It answers `201` with `{ id, token }`: 256 random bits, handed
  over once; only its SHA-256 is stored.
- **`GET /api/devices/pair`**, for the Android phone, which holds no Access cookie
  (`PHONE_PAIRING_ROUTE`): the phone opens it in its browser, Access signs sir in, and its button
  `POST`s to the same path. That is refused `403` unless `Sec-Fetch-Site` is `same-origin` — set by
  the browser, never by a page — or, from a browser that sends none, unless `Origin` names this
  server's own `Host`; so a form elsewhere cannot pair a device. Then the phone is paired and the
  browser is sent, `303`, to `heyjarvis://paired#token=…` — always the app's own scheme, never a
  link the request names. The page is served `no-store`, `X-Frame-Options: DENY`, a CSP that allows
  no frame, and `Referrer-Policy: same-origin`. Not `no-referrer`: under that a browser sends the
  form's `Origin` as `null`, and when the check read `Origin` first, every press from Chrome on
  Android was refused with "Pair your phone from the pairing page itself."
- **`GET /api/devices`** lists them (never with a token) and **`DELETE /api/devices/<id>`** unpairs
  one, so a lost device is one device revoked rather than the ElevenLabs key.
- **`/api/paired/*` must bypass Access.** `POST /api/paired/conversation` takes
  `Authorization: Bearer <token>` and `{ "transport": "webrtc" | "websocket", "participantName":
  "jarvis-…" }`, and answers `{ token }` or a `wss://` `{ signedUrl }` minted with
  `HEY_JARVIS_ELEVENLABS_API_KEY` on `HEY_JARVIS_ELEVENLABS_AGENT_ID` (never the test agent): `401`
  for a token no paired device has, `400` for a malformed request, `502` when ElevenLabs could not
  start a conversation — with a message for the device to show. In Zero Trust → Access →
  Applications, add a self-hosted application for `<your MCP hostname>/api/paired/*` with a single
  **Bypass** policy (include: Everyone); it covers the preflight its `Authorization` header needs,
  and the WebSocket below.
- **`/api/paired/live` is the WebSocket API** (`PAIRED_LIVE_SOCKET_PATH` in `live-socket.ts`): its
  hello has to carry the device's token, which the server checks itself, and a socket whose hello
  does not is closed `4401` — never tried again by the device. Frames sent before the check answers
  are ignored, glance actions included: the device token is the lock on them, since the server runs a
  glance's actions — unlocking a door — for any socket that names them. A device needs no Access
  cookie or JWT for its line, both of which run out with Access's session.

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
4. Pair the phone with this server (its settings, or the tour). Until it is paired, the phone
   offers no camera button.
5. If a 1Password item was created in the `Jarvis` vault for the earlier build's upload key, delete
   it: nothing reads it any more.

## The WebSocket API

Beside the REST routes, the MCP server serves one WebSocket, on the same port, at
**`/api/paired/live`** (`verticals/api/live-socket.ts`). REST is for being asked; this is for what the
server has to say first, and what a device keeps it told of. Each device that is Jarvis — the phone,
the watch and the headset — keeps one open for as long as its app runs, across conversations and
between them, through `connectToServer` in `hologram/src/jarvis-server-link.ts`, once it is paired.

| Direction | Frame | Meaning |
| --- | --- | --- |
| device → server | `{"type":"hello","device":"phone"\|"watch"\|"vr","token":"…"}` | The first frame, within 10 seconds, with the device's token |
| server → device | `{"type":"ready"}` | This socket is now sent every live event |
| server → device | `{"type":"affectedEntities","entities":[{"id":"…","name":"…"}]}` | A request's tool just read or changed these |
| server → device | `{"type":"agentActivity","delegationId":"…","agentId":"…","state":"…"}` | Where one of a request's agents has got to |
| device → server | `{"type":"pointing","entity":{"id":"…","name":"…"}}` or `"entity":null` | What sir points at now, or nothing |
| server → device | `{"type":"glance","glance":{"id":"…","url":"…","title":"…","generatedAt":"<ISO 8601>","actions":[{"id":"…","label":"…","prompt":"…"}]}}` | The current glance: right after `ready` when there is one, and to every socket whenever a new one is built |
| device → server | `{"type":"glanceAction","requestId":"…","glanceId":"…","actionId":"…"}` | Sir pressed a button on the glance; `requestId` at most 64 characters |
| server → device | `{"type":"glanceActionResult","requestId":"…","ok":true\|false,"message":"…"}` | How that went, to that socket only: Jarvis's answer, or why it was refused |

**The token is the credential**: the device's name in the hello is only for the log. A refusal is a
close: `4400` a first frame that is not a hello, `4401` a token no paired device has, `4408` no
hello in time; an upgrade past 32 open sockets is answered `503`, and one to any other path `404`. A
device tries again with a growing delay after anything but `4400` and `4401`. Frames over a kilobyte close their socket (`1009`), and every socket is pinged
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
