---
paths:
  - "mobile/**"
---

# Configuration

> Part of [Mobile App](mobile.md). Paths in it are relative to `mobile/` unless they say otherwise.

The app ships with no credential, and is told only one thing: **which Jarvis server is sir's, and
it is paired with it.** Pairing is the only way to set Jarvis up, on every app. The server holds the
ElevenLabs key and the agent, starts every conversation on the device's behalf, and gives the device
a token of its own; no app holds an ElevenLabs API key, an agent ID or a Cloudflare Access service
token any more. It is asked for on the tour's server step on first run — or on the settings screen
afterwards — and kept in the Android keystore, or on web in `localStorage`:

| Setting | What it is |
| --- | --- |
| Jarvis server | No secret. The public `https` address of sir's own Jarvis server — the MCP server's tunnel hostname — as an origin, with no path. Kept under `hologram`'s `jarvis.server-address` |
| Device token | A credential, and never typed: what the server answers a pairing with — 256 random bits in base64url, read by `parseStoredDeviceToken` in `hologram`. Kept under `hologram`'s `jarvis.device-token`. Sent as `Authorization: Bearer …` with every conversation request, and in the hello of the line, which opens on `/api/paired/live` |

**How each app pairs.** The server's side is "Pairing a device" in
`.claude/rules/mcp-mcp-server-access.md`. Pairing is the one request that has to prove who is
asking, through Cloudflare Access, and how it does differs by platform (`pair-with-server.ts` against
`pair-with-server.web.ts`, behind `PairWithServer` in `platform-contracts.ts`):

- **The phone app opens the server's pairing page in the browser.** A native app holds no Access
  cookie, so **Pair this phone with your server** (`server-pairing.tsx`) keeps the typed address
  first and then opens `<server>/api/devices/pair` (`phonePairingUrl` in `jarvis-server.ts`) with
  `Linking.openURL`. Access signs sir in there as it does any page; the page's button pairs the phone
  as "Android phone" and sends the browser on to `heyjarvis://paired#token=…`, the app's own scheme.
  The app reads the token out of that link (`pairedTokenFromLink`, by hand, since React Native's
  `URL` and `URLSearchParams` cannot read one) in `use-pairing.ts` and keeps it beside the address
  it opened the page for — which is why the address is kept before the page is opened: the link names
  no server, and the app may be stopped while the browser is up. `server-pairing.contract.spec.ts`
  holds the page's path, the link and the scheme to the server's `PHONE_PAIRING_ROUTE` and
  `PHONE_APP_PAIRED_URL` and to `app.config.ts`.
- **The web build pairs itself** — see [Web](mobile-web.md).

**A pairing is with one server.** Pairing with another address forgets the token there was, and
**Forget this server** on the settings screen forgets both — and the app is then not set up, so it
opens on the settings screen with sample mode on offer. **The watch shares the phone's pairing** (see
[Handing the credentials to the watch](mobile-handing-the-credentials-to-the-watch.md#handing-the-credentials-to-the-watch)),
so unpairing the phone on the server unpairs the watch too.

**No pairing, no conversation.** `conversation-credentials.ts` asks the paired server for every
conversation (`pairedCredentials` in `hologram`), and without both an address and a token there is
nothing to ask: the app is not set up, exactly as it was without ElevenLabs settings before. For each
conversation the server is sent `POST <server>/api/paired/conversation` with
`{"transport": "webrtc", "participantName": "jarvis-android"}`, asks ElevenLabs for a WebRTC token
for Jarvis's agent with its own key, and hands it back; the session runs on the token. The line, the
glance and the camera use the same server, and are there only once the app is paired.

**A read of the pairing that fails is tried again**, rather than taken for none (`read-again.ts`):
a summoned Jarvis whose keystore throws once in a window still coming up would otherwise open sample
mode with the pairing in the keystore the whole time. Both halves are read again on every summoning
after the first (`use-pairing.ts`), since the assistant's window keeps its own copy of what it read
and the pairing is as often made in the app's own window — the one the pairing link opens.

**Except for a text-only conversation, which asks the server for a signed URL instead (`"transport": "websocket"`, which it asks of ElevenLabs' `get-signed-url`) and runs on a WebSocket.** That is the one case where the transport cannot be WebRTC: a text-only session publishes no audio, ElevenLabs' room waits for the client to publish some before it finishes coming up, and a conversation token can only be spent on a room. Dialled over WebRTC it therefore never connected *and never failed* — the screen sat on "Connecting…" indefinitely, which is what a browser with the microphone switched off used to show. Only a browser ever takes this branch: a phone with no microphone says so and stops, and `@elevenlabs/react-native` refuses a signed URL on a device outright.

**That branch was write-only until it learned to show his answer.** A text-only session returns the reply as an `agent_response` over the socket and never as audio, and nothing in the app rendered it — no transcript, no `onMessage`, nothing. So a browser with the microphone refused could send a line, get an answer, and display absolutely nothing: a silent sphere and an empty screen, indistinguishable from a conversation that had failed. `hologram/src/written-reply.ts` keeps the last thing he said — the last, not a transcript, and cleared the moment you send again so a stale answer never sits under a fresh question — and `written-reply-line.tsx` puts it above the field. It is the only screen in the app with something to read on it, because it is the only one with nothing to listen to.

**The sphere speaks it, out of the clock.** With no audio there is nothing for the hologram to follow, so it idled through the whole exchange: Jarvis answering you while looking exactly like an assistant who had not heard you. `hologram/src/written-reply.ts` also says how long he should look like he is delivering an answer — its length at fourteen characters a second, floored at 0.9 s so "Yes." is still a beat and capped at 12 s so a long answer is not mimed at length over text you have already read — and for that long the screen hands the drawing the same simulated voice sample mode uses (`useSimulatedVoice` from `hologram/react/sample`, shapes in `hologram/src/simulated-voice.ts`). It is a spectrum built from the clock, so it goes through the fold into bands, the easing, the agitation envelope and the chip bursts exactly as a real voice does, and nothing downstream knows the difference — which is the whole reason those moods are written as spectra rather than as flags on the drawing.

Only ever here. `readingAloud` is set from `onMessage`, which is wired on the text-only session alone, so every conversation that has a voice goes on following Jarvis's real one. The words are genuinely his; the only invented thing is the delivery, and it is invented only where ElevenLabs was asked not to provide one.

**Typing to Jarvis is not that branch, and has not been since he started answering typed lines out loud.** The two were the same thing for as long as the field existed only where the microphone had been refused, and the confusion cost the feature its voice: `textOnly` is what makes ElevenLabs write the reply instead of speaking it, and that override was the only session the field ever appeared in. It is not needed to *send* text. `sendUserMessage` is on `BaseConversation` rather than on `TextConversation`, so a typed line into an ordinary WebRTC session takes exactly the turn a spoken one would — Jarvis speaks the reply, and the sphere follows his voice, because the session follows his audio track (`jarvis-voice.ts`) and `mode` and neither knows how the turn began. So in a browser the field is beside a working microphone as readily as without one, and the text-only fallback is what is left when there is no microphone to hold a voice conversation with at all. **A phone has no field until asked for**: it sat under him as an empty bar on every summoning, and the user asked for it gone. Tapping Jarvis now switches a phone's conversation into writing and back (the session's `setTyping`, and `createTextModeCaption` in `hologram/src/written-caption.ts`). A phone cannot open the text-only session — `@elevenlabs/react-native` refuses WebSocket sessions on a device — so the voice session stays up with the microphone muted, the field appears with the keyboard, and his replies are written above it (his lines are only kept while in writing). **He still answers out loud**, exactly as a typed line into a browser's voice session is answered, and as ElevenLabs' own preview answers one: writing to him is a way to be heard without speaking, not a request for silence. It used to turn his volume to zero and mime the written line on the sphere, and the user asked for his voice back. So the volume is left alone, and the written line goes through `afterSpokenMessage` rather than `afterMessage`, which shows it without starting the mime — the sphere follows his real voice, and a clock on top of it would keep it moving after he had stopped. The mode is applied whenever the session is connected, so a tap during the greeting lands once it is up, and it is never remembered: every conversation starts in voice.

**It also needs the agent's permission.** A typed conversation is asked for by sending the `text_only` override, and overrides are an allow-list: send one the agent does not permit and the server closes the conversation rather than ignoring it. So the session connects, drops immediately, and — because the SDK reports a server-side close through `onDisconnect` and *not* through `onError` — used to say nothing at all: Jarvis faded out because a conversation really had ended, and no line explained why. The screen listens for the ending now, and `platformSettings.overrides.conversationConfigOverride.conversation.textOnly` is on in `elevenlabs/src/assets/agent-config.json`, which reaches the agent only once that project is deployed.

**What a failure says is the server's.** Its refusals are written for sir (`refusalMessage` in
`hologram`'s `paired-device.ts`): a `401` is that this device is no longer paired, and to pair it
again; a server with no ElevenLabs key, or one ElevenLabs refused, says so in its own words; a
server that could not be reached says that. ElevenLabs' own answers never reach the phone — the
server reads only the credential out of them — so nothing a response says can echo a key.

This used to be the other way round: the phone talked to ElevenLabs directly with a key typed into
it, and the Jarvis server was an optional address for photos, with a Cloudflare Access service
token pasted beside it for the line. Both are gone. A key on the phone was a live account credential
on every device, and a service token was one more thing to paste; a pairing is one sign-in, and a
token the server can revoke for one device.

The device token is a real credential on the phone. What the keystore does and does not do for it:

- **It keeps it from other apps.** `expo-secure-store` encrypts the entry with a key held in the Android Keystore, which only this app's user ID can use.
- **It keeps it out of backups.** The `expo-secure-store` config plugin in `app.config.ts` adds backup and data-extraction rules that leave its storage out of Google's cloud backup and device-to-device transfer. (After a restore the entry would not decrypt anyway, since the keystore key never leaves the phone; the app then simply opens on the settings screen, to be paired again.)
- **It does not protect it from an update of this app — and the side-loaded APK makes that easy.** Anything installed as an update of `com.ffmathy.heyjarvis` runs as the same app and can read the token. Android only accepts an update signed with the same key, but the APK the Mobile APK workflow builds is signed with the Expo template's public debug key (see "Getting an APK onto a phone"), so *any* APK signed with that key qualifies — including the workflow's own builds of pull requests. Never install a pull request's APK over an install paired with your real server; if you did, unpair the phone on the server. Closing this properly means signing with a private release key kept in a CI secret that pull request builds cannot reach.
- **It is not autofill's.** The server field opts out of autofill and password managers.

Reading it can also fail outright — a keystore key invalidated by an OS update, say — and once the retries are spent that reads as "not paired": the app opens on the settings screen rather than hanging on its loading spinner.
