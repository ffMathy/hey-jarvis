---
paths:
  - "vr/**"
---

# The conversation (`src/conversation/`)

> Part of [VR](vr.md). Paths in it are relative to `vr/` unless they say otherwise.

The session is `hologram`'s `createJarvisSession` — the one the phone and the
watch hold their conversations in too (see "One conversation, three devices" in
`.claude/rules/hologram.md`). `createHeadsetSession` (`headset-session.ts`) hands it
what is the headset's: its name (`jarvis-vr`), no platform delay before
dialling, the half-duplex fallback, its words for being offline, his track
analysed on the app's `AudioContext` (`agent-room.ts`), the greeting's `<audio>`
element (`greeting-player.ts`) and the orphaned-audio sweep
(`orphaned-audio.ts`). It tells the agent nothing about the headset.

**The line to the Jarvis server is where the room meets the server.**
`main.ts` opens `hologram`'s line once, as the page loads (`connectToServer`,
when the phone's web build has kept a server address on this origin), and holds
it for as long as the page is open: through the 2D page, every room and every
conversation, and between them. `createHeadsetSession` is handed it (`server`),
listens to it for as long as the session lasts, and returns the session with
the line's `point`.
- **It carries no token, and signs in with a cookie instead.** A browser cannot
  set a header on a WebSocket, so the headset cannot send the JWT the phone and
  the watch send to Cloudflare Zero Trust. It gets through on Access's
  `CF_Authorization` cookie: the 2D page shows whether the line is connected
  (`page/server-status.ts`, from the line's `onConnectionChange`), and while it
  is not, links to the socket's own path (`/api/live`), where Access shows its
  login in a new tab and sets the cookie; the server has no page there, and the
  tab can be closed once the login is done. The line's own
  retries connect within half a minute after. The Access application has to
  hand out that cookie as `SameSite=None` — see "MCP Server Access" in
  `.claude/rules/mcp.md`.
- **What he is working on comes in on it.** The server broadcasts an
  `affectedEntities` frame to every device that has said hello as soon as a tool
  in a request reports what it touched; `serverMessageHandler` hands those
  entities to the room's `onAffected` (passed from `main.ts`, the one
  `ConversationEvents` names), which feeds its entities controller
  (`room.entities.affected`).
- **What sir points at goes out on it.** `ConversationPort.point(entity)` sends a
  `pointing` frame — an entity, or nothing — which the server keeps and writes
  into the requests it routes; the line sends the latest once the server is
  ready, again after a reconnect, and on the next conversation's line too.
- **Without a server address,** nothing is lit by a conversation and pointing
  reaches nobody.

The session holds one summoning
at a time on the ElevenLabs SDK's
own client (`Conversation.startSession` from `@elevenlabs/client`, passed in as
`startSession`), with no React provider, and keeps that provider's guarantees:

- **One start at a time.** A summon is ignored unless the last one is `idle`,
  `ended` or `failed`, because two WebRTC sessions at once tear each other down.
- **Stale callbacks are dropped.** Every SDK callback is bound to the summoning
  that dialled it, and is ignored once that summoning is closed or replaced.
- **Status and mode come only from `onStatusChange` and `onModeChange`.** The
  provider treats any `onError` as the end of the conversation, which would send
  Jarvis away over a non-fatal server message.

Phases run `idle → greeting → connecting → live → ended`, with `failed` as a
separate terminal state:

- **What fails.** Every way a summoning can go wrong ends in `failed`, with
  `onProblem` called first: the token request, a rejected start, an SDK error
  before the conversation opens, the `GIVE_UP_CONNECTING_AFTER_MS` deadline, and a
  `reason: 'error'` disconnect once open.
- **What every ending does.** It stops the greeting and ends the session. A
  session that connects after the deadline gave up on it is ended the moment its
  start resolves.
- **Why `failed` is separate from `ended`.** In the room, an ending is Jarvis
  leaving, while a failure is a panel that has to outlive him.

**The greeting and the token start together; the session is dialled behind the
greeting.** The token request (as `jarvis-vr`) goes out the moment he is
summoned, alongside the recording, which is hologram's `assets/greeting.mp3`
imported with `?url`.

- **Why not wait.** The user wants the conversation up by the time he has
  asked. What clipped the phone's recording was Android switching into call mode
  mid-greeting, and the headset's microphone is already open for the wake word
  with the processing the call asks for, so nothing switches here.
  The session dials while he is still arriving, and mutes from `onConversationCreated` until he has finished, so the agent never
  hears the greeting.
- **A recording refused after dialling.** Dialled during the arrival, the agent
  was already told not to greet, so it stays quiet until sir speaks.
- **A refused recording.** Refused before anything was dialled, the session sends no override, so the agent keeps its
  own first message. A recording the browser never answers for is given up on by
  the shared `isGreetingOver` rule.
- **Checking the greeting's end.** The 50 ms timer checks it, and so does every
  read of his voice, so a throttled timer never holds the microphone muted.
- **Unlocking autoplay.** `prime()` on the player, inside the Enter tap.

**Three things can hold the microphone muted, and it opens only when none of them
does:** the greeting; the keyboard (`setTyping`, the phone's text mode); the
half-duplex fallback while he speaks, which only the headset asks for.
`half-duplex.ts` (in `hologram`) turns that fallback on for
the rest of a conversation when an interruption comes within 300 ms of him
starting to speak, or when two interruptions arrive with no transcript of the user
between them — both signs of his own voice coming back through a weak echo
canceller. It gives up barge-in, so it shows on the HUD.

**What the hologram reads from the session**, read again on every frame because
the object changes when its source does:
- `voice` is the greeting's envelope while he greets. Once connected, it is his
  LiveKit track, analysed on the app's `AudioContext` (`agent-room.ts`), with the
  SDK's readers as a fallback. Otherwise it is silence.
- `user` is hologram's `vad_score` keeper, deaf while he speaks or greets, plus
  the SDK's input level.
- `thinking` comes from hologram's `createToolActivity`.

**His voice from where he stands** (`spatial-voice.ts`, with the route in
`voice-route.ts` and what it watches for in `voice-watch.ts`). Three tiers,
safest last:

1. **Spatial.** The greeting and then his track go through one HRTF panner at his
   centre — the room hands over his anchored position every XR frame, after the
   hologram has followed the anchor — and the AudioContext's listener follows the
   centre eye (position, forward and up), small steps glided over 30 ms and a new
   spot jumped to. Distance is `inverse`, full level within a metre, half the
   usual rolloff beyond it, so at 1.6 m he is at about three quarters of the level
   the headset played him at. His track's one `MediaStreamSource` feeds both the
   sphere's analyser and the panner. The SDK's own `<audio>` element keeps playing
   at **volume 0 — never muted, never paused**, and only while his track really is
   going through the panner (`agent-element-volume.ts`): Chromium pulls a remote
   WebRTC track into Web Audio only while an element renders it, applies the
   element's volume after that point, and LiveKit sets `muted = false` again on
   every attach and every microphone acquisition. Every element is found — on the
   page when the volume changes, from LiveKit's `ElementAttached`, and from a
   `MutationObserver` on the body. The greeting's element is taken into Web Audio
   (`createMediaElementSource`, once per page for good) only when he first greets
   from where he stands.
2. **Element.** The SDK's element plays him from the headset, exactly as before.
3. **Half duplex.** The session's fallback (see below), on top of the element.

**Which tier.** Spatial only when the wake word's own microphone track offers
`echoCancellation: 'all'` in its capabilities (`echo-canceller.ts`) — on Android
that means the device has an echo canceller of its own, which subtracts whatever
the device plays, Web Audio included. Without it Chromium runs WebRTC's canceller
in the page, whose reference is only WebRTC's own playout after the element's
volume: a voice panned through Web Audio would not be subtracted, and an element
at volume 0 would hand it silence. The setting off, or no panner in the browser,
also means the element. `?voice=spatial` skips the probe; the setting still wins.
**Nothing is built on the element tier from the start**: no node, the greeting
never taken in, the page as it was before.

**What moves him to the headset,** each on its own, for the rest of the page's
life (a reload tries again): an interruption within 300 ms of his voice starting,
measured from the audio (−45 dBFS after half a second of quiet) rather than from
the SDK's lagging mode; two interruptions with no transcript of the user between
them; a transcript of the user that repeats a line of his from the last ten
seconds (`echo-transcript.ts`: half their words shared, or four in a row, and
never on fewer than three words); the AudioContext stopped for half a second; and
LiveKit's server saying he is speaking while under 1e-4 reaches the panner for
1.5 s — the server's word, because WebRTC's own received level is measured after
the element's volume and reads nothing at volume 0. Moving restores the element's
volume at once, fades the panner branch out and disconnects it; the analyser
stays. A greeting already taken into Web Audio plays centred through a dry branch
from then on, and one whose AudioContext has stopped is reported refused, so the
agent says its own first line instead of him greeting in silence.

**The half-duplex fallback waits its turn** through `halfDuplexMayJudge` (a hook
only the headset passes to `hologram`'s session): it counts no interruption while
he is spatial, since an echo there moves him to the headset first, nor for three
seconds after he moves, while the browser's echo canceller settles on the
reference it has just been given. The session's `onInterruption` and `onMessage`
events are what the watch hears.

**What the session does on your behalf:** it calls `flushQueuedAudio` on the
room's agent tracks when interrupted; captions follow `written-reply.ts`, and only
while you are writing (the keyboard is up, or the last thing you said was typed —
a typed line that comes back as a transcript is recognised and ignored:
`createWrittenCaption`, hologram's `while-writing` rule); after a
dropped connection it removes the hidden `<audio>` elements the SDK leaves behind
(`orphaned-audio.ts`); and `quietFor(seconds)` tells the room how long his output
has been silent, for re-arming the wake word.

**Failure texts** (hologram's `failure-text.ts`) are the phone's wherever the phone
has one, on every device. The raw texts are replaced: the browser's "Failed to
fetch" (the headset says it in its own words, `HEADSET_OFFLINE_PROBLEM`), LiveKit's
text for a room it could not open ("The connection to ElevenLabs could not be
opened. The network may be blocking it."), and "LiveKit connection state changed
to disconnected" — told by the SDK's `connection_state_changed` disconnect
context, never by its text. A message that looks like it contains a credential is never
shown.

`agent-room.contract.spec.ts` checks four things in the installed SDK: that it
still keeps the room on `connection.getRoom()`, that it builds that room from the
same `livekit-client` this app imports (so `instanceof Room` can match), that it
still closes a room LiveKit gave up on with the `connection_state_changed` context `describeDisconnect` looks for, and, at compile
time, that `Conversation.startSession` still fits `StartSession`; it also pins how
the SDK sends a context id, which `hologram`'s fakes copy. The session's own
behaviour is pinned in `hologram` (`jarvis-session.spec.ts` and
`jarvis-session-conversation.spec.ts`, set up the way `createHeadsetSession` sets
it up, driven by the fakes in `jarvis-session.fakes.ts`, which fire callbacks in
the SDK's own order); `headset-session.spec.ts` checks the headset really does set
it up that way. `greeting-recording.ts` is the only
file that imports `?url`, so `bun test` never loads it; `mp3-url.d.ts` declares
only `*.mp3?url`, never hologram's numeric `*.mp3`, which vr must not reach.
