# Hologram

Jarvis himself: the sphere, the voice tracking that drives it, and the
conversation with the agent doing the talking. Shared by every app that *is*
him — `mobile/` and `watch/`, and `vr/`, the Quest headset app that stands
him in your room, which uses the main entry, `hologram/gpu` and the assets.

> **Note:** See the root [AGENTS.md](../AGENTS.md) for shared conventions (Turborepo commands, commit standards, 1Password, etc.)

## Four entry points

```
hologram               the design, the voice tracking, the ElevenLabs credentials, and the
                       conversation's framework-free parts — no framework
hologram/gpu           his body on the GPU: the headset's passes and a renderer over a bare
                       WebGL 2 context — no framework either
hologram/react         the same sphere as a React Native view you can render
                       (plus ./react/lifecycle and ./react/sample, which are Skia-free)
hologram/conversation  the hook a React Native screen holds its conversation with
hologram/assets/*      the files themselves (the greeting, the icons), for a bundler that takes
                       a file as a URL
```

The split is the whole architecture of this package, and the rule below is why
it exists. Reach for `hologram` when you want to know what Jarvis looks like,
how loud someone is, or what it takes to reach his agent; `hologram/react` when
you want him on a screen; `hologram/conversation` when you want him talking;
`hologram/gpu` when you want his body drawn by a GPU rather than by Skia.

**Why the ElevenLabs half is in here rather than in a package of its own.** It
was briefly its own workspace package, and that was one package too many: the
two halves are the same thing seen from two sides. A sphere with no conversation
is a screensaver and a conversation with no sphere is a phone call, and both
devices want both. Keeping them together also keeps one rule instead of two
about what may import what — see below — and the entry points already carry
that rule.

## What is in each

| Entry | Imports | What it holds |
| --- | --- | --- |
| `hologram` | types, its own siblings, and the plain values of Skia's enums | the drawing and the frame analysis behind it, the frame clock every device steps him on (`frame-clock.ts`) and the numbers it runs by (`frame-timing.ts`), the phone's tilt to look around (`tilt.ts`), which renderer draws his body and where each starts the density loop (`body-layer.ts`), the voice tracker, the simulated voices, sample mode's moods, the voices each mood hands the sphere (`sample-drive.ts`) and its readout text, the density control, the ElevenLabs credentials, how they are stored and the token request, and the conversation itself: the session every device holds it in (`jarvis-session.ts`, its shapes in `session-contract.ts`), what its failures say (`failure-text.ts`), which of his lines it writes down (`written-caption.ts`), the headset's half-duplex fallback (`half-duplex.ts`), what a request touches and what sir points at (`affected-entities.ts`: an entity's shape, its limits and its parser), which agents a request has at work (`agent-activity.ts`) and the satellites they are drawn as (`agent-work.ts`, `satellite-drawing.ts`), the line every device keeps to the Jarvis server during a conversation (`jarvis-server-link.ts`), and the pieces it is built from — whether a conversation is open or has ended and how long to wait for it (`conversation-life.ts`), which tool calls are in flight (`tool-activity.ts`), the latest `vad_score` (`vad-score.ts`), his voice as a browser plays it (`played-voice.ts`), finding his track in the room (`agent-audio-track.ts`), dropping what an interruption leaves queued (`queued-audio.ts`) and his last written line (`written-reply.ts`) |
| `hologram/gpu` | types, its own siblings and the main entry's modules — the context is handed in | the body's fragment arithmetic in GLSL and the CPU reference it is held to (`fragment-glsl.ts`, `fragment-3d.ts`), the rows every pass reads and their vertices (`body-rows.ts`, `row-vertices.ts`), the halo union, the strokes and the halos' light as shader sources (`halo-union.ts`, `body-strokes.ts`, `halo-light.ts`), the sparkle's bytes (`sparkle.ts`), the view-basis maths (`view-basis.ts`), and the raw renderer the phone and the watch draw it with (`gpu-body.ts`) through the camera a flat screen needs (`flat-camera.ts`) |
| `hologram/react` | React, Reanimated, Skia, and expo-gl once its native module is found | the Skia canvas, the GPU body's canvas over it and everything that decides which draws the body (`body-layer.tsx`, `gl-context.ts`), the tilt's sensor (`tilt-sensor.tsx`), and the frame callback that steps the frame clock |
| `hologram/react/sample` | React, Reanimated — not Skia | sample mode's clock-made voice, mood toast and frame-rate readout, shared by the phone's sample screen and the watch's waiting screen |
| `hologram/conversation` | React, `@elevenlabs/client`, `@livekit/react-native`'s audio session, hologram's own native greeting player (`expo-audio` in a browser) — not Skia | `useJarvisSession`, which hands the main entry's session the SDK, the greeting's player and the call's audio, and holds its snapshot for a screen |

`hologram/conversation` deliberately does **not** reach Skia. That is what lets
a screen open a conversation before CanvasKit has finished loading in a browser,
which is the case `mobile/src/jarvis-hologram.web.tsx` exists to handle — and it
is why the conversation hook is not simply part of `hologram/react`.
`react.contract.spec.ts` holds it to that, as it does `./react/lifecycle` and
`./react/sample`, and keeps all three clear of expo-gl too: only the view may
load it, and only once it has found expo-gl's native module in the build.

## The rule that makes this package work

**Nothing in the main entry imports a value from outside the package**, with one
exception. Its modules import each other, and everything else they import is
`import type` — apart from `hologram-drawing.ts`, which takes Skia's enums
(`BlendMode`, `StrokeCap` and the rest) as values from the package's type
module, `@shopify/react-native-skia/lib/module/skia/types`. That module is
plain numbers with no imports of its own, so it loads under `bun test` and in
a browser as readily as a type does, and the enums are only read on the JS
thread, in `createHologramResources`. That is not tidiness; it is the reason
the same drawing runs in four places:

- native Skia, on a phone or a watch;
- CanvasKit, in the browser build published to GitHub Pages;
- CanvasKit headless, in `hologram-drawing.spec.ts` and the contact sheets;
- the headset, which has no React at all.

`main-entry.contract.spec.ts` holds every module directly in `src/` to it, by
parsing them with Bun's own transpiler: an import or re-export not marked as a
type, from anywhere but a sibling or that one Skia module, fails it. A path into
`./react` or `./conversation` counts as outside, since those are other entries.
Mark a type-only import `import type` (or each specifier `type`) even where a
bundler would drop it anyway — the test counts what the source says.

The two ElevenLabs files keep the same rule for the same payoff. `fetch` is a
global rather than an import, so the token request and every failure ElevenLabs
can answer with — a rejected key, a key without permission, an unknown agent, an
account out of credits, a rate limit — are driven in `conversation-token.spec.ts`
with no account, no credential, no SDK and no device.

`hologram-drawing.ts` takes the Skia factory and the canvas as arguments, typed
as `HologramSkia` and `HologramCanvas` — `Pick<>`s of the real types naming only
the calls it makes. Adding a call means widening those picks, which is the point:
the type says exactly how much of Skia the hologram needs.

**`hologram/gpu` keeps the same rule.** It runs in four places too — under `bun
test`, in the headset's browser beside three.js, in a browser beside CanvasKit
and on a phone or a watch beside expo-gl — and imports none of them. The headset
wraps its shader sources in three.js materials (`vr/src/hologram3d/`), and the
raw renderer, `createGpuBody` and `drawGpuBody`, takes the GL context as an
argument typed as `HologramGl`, a `Pick<>` of `WebGL2RenderingContext` naming
the calls it makes, which a browser's context and expo-gl's both fit; the GL
enums are numbers in the module rather than read off the context. Its modules
import the main entry's modules directly (`../hologram-drawing`,
`../frame-timing`), never the `..` barrel, for the reason under "Worklets"
below. `gpu.contract.spec.ts` holds it to both, parsing every module with Bun's
transpiler as the main entry's contract does: a value from anything but a sibling
or one module directly in `src/` fails it, and so do the `..` barrel and the
other entries (`../react`, `../conversation`). Biome reads `gl.useProgram` as a
React hook, so `biome.json` turns `useHookAtTopLevel` off for that folder alone,
where nothing is React.

What runs every frame there is a worklet — `drawGpuBody` and everything it
calls, `placeFlatCamera`, `writeFragmentUniforms` and the view-basis maths — so
an app can draw on whichever thread holds its context. `createGpuBody` is
JS-thread code: it builds the rows, compiles the three programs and uploads about
3 MB of vertices, once, and throws when the context refuses any of it (an ES 2
context cannot compile the GLSL ES 3.00 shaders), which is the app's cue to keep
the body in Skia. On a phone the body it returns then crosses to the UI thread,
and worklets copy nothing between runtimes but plain objects, arrays and typed
arrays, while expo-gl makes every GL object an instance of a class of its own.
So the body keeps a plain `{ id }` in place of each of expo-gl's, which is all
expo-gl reads of one, and a browser's as they are; `gpu-body.spec.ts` holds it
to that with a context that makes them the way expo-gl does. Nothing deletes
what it made: it goes with the context, and a GL call from the JS thread while
the UI thread draws could race it. The renderer leaves GL state as it set it, so
it needs a context of its own. It draws what the headset draws, pass for pass and in
three's order — the halo union into its own target, then the strokes, then the
halos' light, Screened and faded as one layer — and whether the pixels agree is
a browser's to say: vr's `hologram-gpu-body.spec.ts` draws the same moments both
ways in Chromium, from the matrices three drew with, and fails on one byte
apart. Here, `gpu-body.spec.ts` checks the passes, their targets and their
blending against a context that writes its calls down.

`src/react/` is where React, Reanimated, Skia and expo-gl are called for real,
and it is deliberately thin: a Skia canvas and the GPU body's canvas over it, a
frame callback, the voice read every 40 ms, and the tracker stepped on the UI
thread. It takes a `JarvisVoice` and asks it
two questions — nothing in it knows where the audio came from, so the phone can
hand it a WebRTC track and the watch its own microphone.

Two things in the view are there for speed on a device and nowhere else. It
times how long each picture takes to build, which is what the density loop in
`density-control.ts` steers by. And on Android it records the whole picture,
background included, inside one layer (`DRAWN_IN_A_LAYER`): React
Native Skia gives its Android window no stencil buffer, and without one Skia
triangulates the particle halos on the CPU every frame, where a layer Skia
allocates itself can have a stencil and the halos go to the GPU as they do in a
browser. That was found in a CanvasKit model of the two canvases rather than on
a phone, and the constant's comment says what it assumes of the GPU. The
drawing's half of the same work is that the scene's body and shell rows are
kept in the order of the density share's key (`roundedInDensityOrder`), so the
loop stops where the kept rows end (`densityRowsEnd`) instead of reading every
row to throw most of them away — which under Hermes, with no JIT, was 4.1 of
the 5.3 ms a picture took to build at the floor, on a desktop harness. And the
loops that run once a fragment or crescent piece (`appendBody`, `appendStream`,
`appendCrescent`) are written out by hand rather than composed from the per-fragment helpers,
because on a device every call between worklets allocates: on the same kind of
harness a full-density picture went from 18.9 to 5.9 ms to build, and one at the
floor from 0.63 to 0.32. The helpers stay the definition — the headset is built
from them — and `particle-loop.spec.ts` holds the loops to them bit for bit, so
change a fragment in its helper first. That one file is allowed functions as
complex as the body's loop in `biome.json`, since splitting the loop back up is
the cost it exists to remove.

`src/conversation/` is where the ElevenLabs SDK is called for real, and it is
thinner still: `useJarvisSession` hands the main entry's session
`Conversation.startSession`, the greeting's player, the call's audio and a
timer, and holds its snapshot in React. Every rule of the conversation is the
main entry's — see below.

If you find yourself wanting a microphone, a permission prompt, a navigation
decision or a screen layout in any of the four, it belongs in the app, not
here.

## One conversation, three devices

`createJarvisSession` (`jarvis-session.ts`) is the conversation on every device:
the headset calls it directly, and the phone and the watch through
`useJarvisSession`. It holds one summoning at a time on the SDK's own client —
the SDK's React provider is not used anywhere — and it is the only place the
rules live:

- **One start at a time, and stale callbacks dropped.** Every SDK callback is
  bound to the summoning that dialled it.
- **Status and mode come from the SDK's status and mode callbacks only.** The
  provider marked any `onError` as the conversation's end, so on the phone
  Jarvis faded out over a non-fatal error while his voice played on. An error
  once connected goes to the diagnostics and no further; the ending is
  `onDisconnect`'s to report.
- **Every failure ends in `failed`, with a problem in words** (`failure-text.ts`)
  and where it came from (`reaching`, `deadline`, `session` — the phone toasts
  the last). Raw texts — the platform's for being offline, LiveKit's for a room
  that would not open or closed — are replaced, and nothing that looks like a
  credential is ever shown.
- **The deadline ends what it gives up on.** A conversation that connects after
  `GIVE_UP_CONNECTING_AFTER_MS` is ended the moment its start resolves; on the
  phone it used to connect under a line saying it had not.
- **The greeting and the token start together** and the session is dialled
  behind him on every device, muted until he has finished.

Everything that differs by device is handed in, and the main entry stays free of
platforms: the participant name, the timers, how his track is listened to
(`findRoom`, `followAgentVoice`), the call's audio a phone and a watch greet
inside (`callAudio`: let go at once when nothing was dialled, otherwise only once
the conversation has finished ending), a network to bring up first (`untilOnline`
and `leaveNetwork`, the watch's Wi-Fi), the deadline's words, which of his lines
are written down (`captions`: the headset's while-writing, the phone's text
mode; a `textOnly` summoning — a browser with no microphone — writes and mimes
every line), the half-duplex fallback (the headset's alone) and the SDK's
connection delay (the headset's is zero). A screen reads it through `snapshot`
and `subscribe`, which only tell it about changes, so a React screen renders when
something it shows has moved.

Three optional hooks exist for the headset's spatial voice, and only the headset
passes them, so the phone and the watch behave exactly as they did without them.
`halfDuplexMayJudge` is asked at every interruption whether the half-duplex
fallback may count it: the headset says no while his voice comes from where he
stands, because an echo there moves his voice back to the headset's own speakers
first, and for three seconds after that move while the echo canceller settles.
`onInterruption` and `onMessage` (in the events) tell the holder what the SDK
reported, after the session has dealt with it, so the headset can watch for his
voice coming back through the microphone.

`giveUpConnectingAfterMs` sets the deadline, `GIVE_UP_CONNECTING_AFTER_MS` when
left out, and no device sets it. Only the headset's browser tests pass it,
`Infinity` from `?deadline=never`, because they keep him greeting on a token that
never comes while an emulator draws a frame a second or slower, and the shared
twenty seconds raced them on a slow machine (see "The browser tests" in
`vr/AGENTS.md`). An infinite wait arms no timer at all: a browser runs a
timer of `Infinity` at once, and the specs' fake clock does the same, so a session
that handed it over would fail in their hands as it would on a page.

Its specs are the headset's (`jarvis-session.spec.ts`,
`jarvis-session-conversation.spec.ts`, set up the way the headset sets it up) and
the phone's and the watch's (`jarvis-session-devices.spec.ts`), all driven by the
fakes in `jarvis-session.fakes.ts`, which fire callbacks in the SDK's own order.

## What he is working on, and what sir points at: the line to the server

**Neither goes through the voice agent.** The session dials with no client
tools at all, on any device. Both travel over the WebSocket each device keeps
open to sir's Jarvis server for as long as its app runs, across conversations
and between them (`jarvis-server-link.ts`; the server's end is
`mcp/mastra/verticals/api/live-socket.ts`). The line knows nothing of
conversations: `connectToServer` opens it — with the JWT for the Cloudflare
Zero Trust application in front of the server on the upgrade request, as
`Authorization: Bearer` and `cf-access-token`, when the device has one
(`serverAuthorizationHeaders`; React Native's `WebSocket` takes headers, a
browser's cannot, so the headset and the phone's web build connect without
them) — says `hello` with the device, and
tries again after a drop until it is closed. The phone and the watch hold it
from their app component (`useJarvisServer`, in `hologram/react/lifecycle`), and
the headset's page opens it once as it loads and hands it to each session. A
device with no server address has no line, and loses nothing but these two.

**What a request touches comes from the server.** As soon as a tool in a request
reports what it read or changed, the server broadcasts
`{"type":"affectedEntities","entities":[{"id":…,"name":…}]}` to every socket that
has said hello, and `readServerMessage` hands it to every listener the line has
(`ServerLink.subscribe`) as a `JarvisServerMessage`. The phone and the watch
listen to nothing, and the headset's session listens for as long as it lasts,
recording the entities and lighting them up where they stand. An entity is `{ id, name? }` (`affected-entities.ts`). The id is
**opaque** — a Home Assistant light, an email inbox, a calendar, whatever an
agent reports — and is compared, never parsed; the name is for display only. The
frame comes over the network from outside the device, so `affectedEntitiesOf`
reads it strictly: the declared shape only, each value trimmed and non-empty, an
id of at most 200 characters and a name of at most 120, no more than 50 per
message, each id once, and anything else left out. A frame that names nothing
usable is dropped.

**Which agents are at work comes from the server too.** As a request's plan names
each delegation, its agent starts, calls a tool, stops to ask, and answers or
fails, the server broadcasts
`{"type":"agentActivity","delegationId":…,"agentId":…,"state":…,"glyph":…}`, the
state one of `planned`, `working`, `tool` (a moment: still working after it),
`asking`, `answered` and `failed`, and the glyph the SVG path its agent's
vertical on the server draws it with (`mcp/mastra/verticals/agent-glyphs.ts`).
`agentActivityOf` (`agent-activity.ts`) reads it as strictly as an entity: both
ids opaque, trimmed, non-empty and at most 200 characters, the state from that
list, a glyph of at most 1000 characters made only of the path commands M, L, H,
V, A, C, Q and Z and numbers (`DRAWABLE_GLYPH`), and anything else dropped — a
glyph on its own, the message without it.

Every device that shows them shares one lifecycle, `agent-work.ts`: a satellite
per delegation, dim while planned, lit while working, flaring on each tool call,
pulsing while it asks, folding into him when it answers and drifting out when it
fails; gone after 90 s without news, at most 8 at once. It says where each is as
a place on a tilted ring of radius 1 (`satelliteOrbits`, `orbitPoint`), and each
device scales that to his size and adds its own clock, so they go round as
smoothly as that device draws him. The headset draws them in the room
(`vr/src/hologram3d/satellites.ts`); the phone and its web build draw them on the
screen, in the same picture as him (`satellite-drawing.ts`, the same glyphs
as Skia strokes, dimmer and smaller passing behind him). On the phone,
`useJarvisServer` returns the line, `useAgentSatellites` (in
`hologram/react/lifecycle`) works the satellites out on the JS thread every
`READ_INTERVAL_MS` into a shared value, and `JarvisHologram` draws whatever its
`satellites` prop, or the nearest `AgentSatellitesContext`, holds. The watch
holds the line and shows none.

**No device knows any agent's glyph.** Each vertical on the server declares its
own, in its `glyph.ts`, and it comes with every message, so a new agent needs no
change on any device. A satellite whose messages brought none is a plain ring
(`PLAIN_RING_GLYPH`). A glyph is an SVG path in glyph radii — it fits the circle
of radius 1 — with y down, drawn as round-capped strokes `GLYPH_STROKE_WIDTH`
wide: by Skia on the phone, from the string each frame (and the paths released
after recording in a browser), and by a 2D canvas into the headset's glyph
atlas. Sample mode's three pretend agents have made-up glyphs of their own
(`SAMPLE_AGENTS`), since the real ones are only the server's. With `pretending`, the hook has sample mode's
three pretend agents at work (`pretendWork`), so they can be seen with no server.

**What sir points at goes to the server.** `ServerLink.point(entity)` sends `{"type":"pointing","entity":{…}}`, or `"entity":null` for
nothing, held to the same limits (`affectedEntityOf`). Only the latest is kept:
it is sent once the server has said `ready`, at once if it already has, again
after every reconnect's `ready` (the server keeps the latest per socket, and a
new socket starts with none). The server writes it into every request it
routes, as `(pointing at "<name>", id <id>)`. Only the headset points at
anything.

**`sendContextualUpdate(text, contextId?)` tells the agent something without
asking it anything** — on the phone, what its camera button is doing (see "What
the phone's camera button needs of it"). It is sent while connected (not only
live: a browser's conversation is up behind the greeting), in a `try`, since a
socket that is going throws. Before that, the latest update for each context id,
and every update said without one, waits for the summoning under way and goes
the moment it connects, before the phase moves to `live`, so anything the holder
says on `live` lands after it; whatever is waiting when the summoning ends is
dropped, and with no summoning under way nothing is kept. The server keeps only
the newest update for a context id, which is what the ids are for, and every
update without one, which is why none of those replaces another while it waits.
No device says anything about itself on connecting.

## Two things about the ElevenLabs half worth knowing before changing it

**The participant name is a required argument, not a default.** Each device
names itself in the ElevenLabs conversation history — `jarvis-android`,
`jarvis-wear` and `jarvis-vr` — and the point of the names is to be told
apart, so a conversation held on the wrist is distinguishable from one held in
a pocket or in a headset. All three constants are in `conversation-token.ts`
and none is the default, because a default is how the watch ends up filed under
the phone's name.

**Nothing from an error response is ever repeated back.** `conversation-token.ts`
reads only `detail.status` and `detail.code`, and only when they look like the
fixed identifiers they are. The free-text message beside them is never read: it
can echo the request, and the request carried the API key. There is a test that
puts a key-shaped string in every field of every failure and asserts it never
reaches the message.

`simulated-voice.ts` is the one place with no `'worklet'` on anything, and that is deliberate: it
is read where a voice is read — the JS thread, every 40 ms — and never on the UI thread. It makes
up the two voices sample mode can show without a microphone, Jarvis speaking and Jarvis working,
as spectra, so they go through every step a real voice does and nothing downstream can tell.
It also makes up someone talking *to* him (`simulatedUserAt`) — a voice-activity score and a
microphone level — for sample mode's listening phase.

**Listening is not a voice of his.** While someone talks to Jarvis his particles snap onto a
hexagonal lattice that turns slowly inside the ball and breathes with how loud they are
(`latticeFragment`, `latticeTarget`); the whorl recedes so the lattice is what is seen. It is
driven by a `UserVoice` — ElevenLabs' `vad_score` and the microphone's input level in a
conversation, `simulatedUserAt` in sample mode — handed to the view as `user`, eased per frame by
`hearing.ts`. Only the score switches it on, past the firmware's own 0.25, so the phone, the watch
and the Voice preview agree on when someone is speaking; the level only sets how hard the lattice
breathes. It replaced a ring of ticks outside the limb, which the user found too plain, and was
chosen over drifting clusters, orbital rings, ripples and a galaxy's arms.

**The arrival is a vortex.** Particles leave the core nearest first and spiral out a turn and a
half before settling (`swirlFragment`); it moves only the particles being drawn, so the scene's
count and the density share hold throughout. `.scripts/render-preview.ts` renders the arrival, the
listening lattice and the greeting to WebM for looking at.

**Sample mode is shared, and only sample mode has a readout.** Both devices have one — the phone's
before there is an account, the watch's while it waits for the phone — so the moods, their order,
their names and the readout's text live in `sample-mode.ts`, and the voice hook, the mood toast and
the frame-rate readout in `hologram/react/sample`. The voices themselves are `sample-drive.ts`
(`simulatedJarvisVoice`, `simulatedUserVoice` and, for a whole mode, `createSampleDrive`): the hooks
wrap it, and the headset's sample mode calls it directly. Each component takes a `style`: where it sits is
the app's decision, since a round watch face and a phone sheet want different places. The
conversation screens show no frame rate and no particle count on either device.

## Summoned, he greets you before he is connected

The voice firmware's trick, on every device, and the session's (`jarvis-session.ts`): "Hello sir,
how can I help?" plays from `assets/greeting.mp3` — the firmware's own recording — the moment he is
summoned, the token is fetched beside it, and the agent is told to skip its first message
(`overrides: { agent: { firstMessage: '' } }`, the firmware's `first_message: ""`). While it plays
the sphere follows `createGreetingReaders` at the player's own position, and a session dialled
behind it has its microphone muted from `onConversationCreated` until it ends, so the agent does not
hear Jarvis through the speaker as the user. `isGreetingOver` (`greeting-handover.ts`) decides the
end: the recording's end, or its length plus a grace if playback never started — a clock that starts
again once a headset's call link is up, since that wait was not him being late. The things that are
easy to break:

- **On a phone and a watch, he greets as call audio, inside the call's audio session.** Played by
  expo-audio — media, `USAGE_MEDIA` — the recording was not heard on a phone: not on its own, and
  not inside LiveKit's audio session started before him either (tested on a phone). So the session
  first starts the audio session the SDK would (`callAudio`, which `useJarvisSession` fills with
  `call-audio.ts`: the `communication` preset, on the speaker), and then plays
  the recording through this package's own native module, `JarvisGreeting`
  (`android/.../JarvisGreetingModule.kt`), a `MediaPlayer` with `USAGE_VOICE_COMMUNICATION` — the
  stream, route and volume Jarvis's voice uses a moment later. It prefers a Bluetooth headset, then
  a wired one, then the speaker, so the greeting comes out where the conversation will — started on
  the speaker alone, as the SDK does, he greeted from the phone and answered in the AirPods. On a
  Bluetooth headset he then waits for its call link to come up (`untilCallRouteReady`, at most
  2.5 s plus a 250 ms margin, the player's `untilAudible`): played into straight away, AirPods lost
  his first word. LiveKit's `start` does nothing when the SDK calls it again. The session lets the
  call's audio go at once when nothing was dialled — a refused greeting, a hang-up, a token that
  never came — so no call audio is left with no call.
- **Call mode is switched off the main thread, by this package.** Reanimated draws the sphere on
  Android's main thread, and LiveKit switches the device into `MODE_IN_COMMUNICATION` there as its
  session starts — which Android takes a noticeable moment over, so the sphere froze once in every
  arrival, just as the greeting began. So `startCallAudio` first has `JarvisGreeting`'s
  `enterCallMode` switch it on a thread of its own and wait for it, and LiveKit then asks for the
  mode already in force. LiveKit also remembers that as the mode to put back, so `stopCallAudio`
  does the putting back: after LiveKit's stop (a bridge call that only *posts* to the main thread,
  so `getAudioOutputs` on the same bridge queue is awaited first as a barrier), `leaveCallMode`
  queues behind it on the main thread and switches back off it. The session calls it on every
  ending, and for a dialled conversation only once its `endSession()` has resolved, by which time
  the SDK has stopped LiveKit's session. `call-audio.contract.spec.ts` fails if LiveKit or the SDK
  stops behaving the way that order relies on.
- **That makes this package a native module.** `expo-module.config.json` at its root is what both
  apps' autolinking finds, since both depend on `hologram`. In a build without it,
  `greeting-player.ts` reports the recording as unplayable, and the agent keeps its own first
  message. A browser plays the recording with expo-audio (`greeting-player.web.ts`).
- **And the session connects while he speaks, on every device.** The token is fetched beside him
  and the session is dialled the moment it arrives — during his arrival, before the recording has
  even started — muted until he has finished,
  and not at all if he was hung up on. It used to be held back until he had finished on a phone,
  because dialling behind him clipped him there; what clipped him was LiveKit switching into call
  mode a second into the recording, and that switch is now made before he speaks (above), so the
  conversation's start changes nothing he is heard through. Not yet heard on a device: a greeting
  that turns thin or clipped as the conversation connects means something else switches as
  WebRTC opens its microphone, and the fix is to switch that first too, not to dial later.
- **In a browser, only while the microphone is held.** A tab nobody has clicked since it loaded
  refuses to play a sound unless the page is using the microphone, so the phone app's web build
  holds the stream it asked permission with until the session says the greeting has started or
  will not (`onGreetingAnswered`). The session waits for the browser's answer, and if it is no the
  greeting is dropped and the agent keeps its own first message, so he is never left not greeting
  at all.

The session's `user` is the `UserVoice` for the listening lattice. Presence is the latest
`vad_score` (`vad-score.ts`), ignored while he speaks or greets — the firmware's
`speaker_is_active_` rule, since his voice through the speaker scores as the user's — and volume is
the SDK's input level. Both read zero while the session is not connected or its microphone is muted.
The one exception is on a phone and a watch before the agent's first score: the lattice follows the
kept microphone instead (see "What is said while he connects is kept, not lost").

## What is said while he connects is kept, not lost

The session is dialled behind the greeting, but a token, a room and a handshake can still take
longer than he speaks, and whatever sir started saying between his last word and the agent hearing
anything used to go nowhere. So on a phone and a watch the session holds it (`heldVoice`, which
`useJarvisSession` fills from `conversation/held-voice.ts` on a device only), whenever the
conversation is not yet connected once he has finished:

- **Held from the greeting's end** (`hold`), refused greeting included, by `HeldVoice.kt` in this
  package's native module: an `AudioRecord` of its own, `VOICE_RECOGNITION` rather than the call's
  `VOICE_COMMUNICATION`, which in call mode arrives near -54 dBFS and relies on WebRTC's gain control
  — which what is held never passes through.
- **Played through the conversation's own microphone track**, as LiveKit's capture post-processor.
  On a device the SDK has only WebRTC, and it drops any `user_audio_chunk` handed to it over a room,
  so the track is the only way in. The moment WebRTC opens its microphone the recorder stops, what
  it kept is resampled to WebRTC's rate and queued, and every live frame queues behind it; silence
  is sent meanwhile.
- **Released at the agent's first `vad_score`** (`release`), the sign that it is hearing the track,
  or `RELEASE_HELD_VOICE_AFTER_MS` after connecting if none comes: connected only means the room is
  up, and audio sent before the agent listens is lost a second time.
- **Then sent in order, late, and caught up in the pauses**: each frame sends the front of the
  queue; while behind, any pause past 200 ms is skipped; once the queue is empty the live microphone
  goes straight through. Past twenty seconds behind, what is queued is dropped instead.
- **Dropped on every ending** (`drop`), including one that never connected.
- **The lattice follows it until the agent scores.** No `vad_score` arrives before the agent hears
  the track, so until the first one the session's `user` reads the kept microphone instead:
  `level()`, the RMS of its last 40 ms, as the volume, and `presenceFromMicrophoneLevel`
  (`microphone-presence.ts`) as the presence — a loudness gate in the score's own units, nothing
  at -45 dBFS and sure at -30, so it crosses `HEARING_THRESHOLD` near -41. Not while the keyboard
  is up or he is speaking, as for a score. From the first score on, it is the score again.

The rules — when to hold, release and drop — are the session's, pinned in
`jarvis-session-devices.spec.ts`. The audio itself is the native module's, and no test here runs
it: judge it on a device, by saying something straight after the greeting and checking logcat's
`JarvisHeldVoice` lines (`handing over … ms`, then `caught up`).

## Hanging up after a finished request

The apps do not decide this. A finished request that is followed by quiet is ended by the agent
itself — its `turnTimeout` of 3 s and its `end_call` tool — so no device registers a client tool
for it, and each sees it as the agent hanging up. No device registers a client tool of any kind (see
"What he is working on, and what sir points at").

## What the phone's camera button needs of it

Only the phone can show Jarvis something: its camera button takes a photo and sends it to sir's own
Jarvis server, and everything about that — the button, the upload, the notes and messages the agent
is sent — is the phone's ("Showing him something" in `mobile/AGENTS.md`). The agent has no client
tool for it, so no device answers one (no device registers any client tool), and the watch and the
headset hold nothing for the camera at all. What the session gives the phone is general, and three things:

- **The live conversation's id** (`liveConversationId()`, on `JarvisConversation` too). The server
  opens an upload slot only for a conversation ElevenLabs says is in progress on Jarvis's agent, so
  the phone sends it this id when sir taps the button. It is the SDK's own `getId()`, read once,
  when the conversation is handed over — by then it is final on both transports: a socket takes it
  from `conversation_initiation_metadata`, and WebRTC reads it out of the LiveKit room's name before
  the start resolves. It is given only while the summoning under way is connected, so an ended
  conversation's id never is, and only when it looks like an ElevenLabs id (`conv_…`): where a
  room's name holds none, the SDK falls back to the name itself or a `room_<ms>` of its own making,
  which the server could only refuse. It is a method rather than part of the snapshot because it is
  read at the tap, and nothing on a screen is drawn from it.
- **`sendContextualUpdate`**, a note the agent reads without a turn being taken: that this device
  has a camera button, that sir has opened the camera, or that he closed it without a photo. The
  phone's notes carry no context id. (What sir points at on the headset goes to the server, not the
  agent: "What he is working on, and what sir points at".)
- **`sendUserActivity`**, which says sir is still there while he frames a shot. It holds nothing
  open: a quiet call is still the agent's to end (see above), and ElevenLabs does not document user
  activity as holding off either its turn timeout or its silence timeout. What keeps the agent from
  hanging up on the camera is its own rule, that a photo it is waiting for gets `skip_turn` ("Hanging
  up when he goes quiet" in `elevenlabs/AGENTS.md`).

The photo goes to the server, never through the session; what goes through it is the message that
names the photo once it has arrived, or says why it did not, as a user message through `sendText`,
which takes a turn so that Jarvis answers it at once. `sendText` and `sendUserActivity` do nothing,
and the id is `undefined`, unless the summoning under way is connected; a note said before then
waits for it, as every contextual update does, though the phone only says one while connected —
`jarvis-session-conversation.spec.ts` pins the three above.

## Worklets

The drawing, the tracker and the frame clock all run on the UI thread under Reanimated, so every
exported function carries the `'worklet'` directive, helpers are declared before
their callers, and nothing closes over anything but its arguments and
module-level constants. Breaking one of those rules fails at runtime on a device
and nowhere else — the tests call these functions on the JS thread, where a
worklet is an ordinary function.

Modules inside the package import their siblings directly and never `./index`:
a circular import leaves what a worklet captured undefined, which again fails
only on a device, or in the web bundle the mobile e2e runs. Exporting a
function or a constant is safe (the `export` keyword changes nothing about how
it is captured). Moving a constant into a module of its own is safe as long as
nothing that module imports leads back to whoever imports it — `frame-timing.ts`
imports nothing at all — and moving a worklet is safe only if it is still
declared after every worklet it calls.

## A second renderer: the headset

The headset draws the body in three dimensions on the GPU and the rest of him
with CanvasKit, and it composes him from the per-fragment helpers rather than
from copies of them. The GPU half — the fragment arithmetic and its CPU
reference, the rows, and the halo union, strokes and halos' light — is
`hologram/gpu`, which the headset draws through three.js and which a phone or a
watch can draw through `drawGpuBody`. The view's body and shell loops are hand-written copies of
those same helpers, for speed, and `particle-loop.spec.ts` holds them to the
helpers bit for bit. So the main entry exports what that needs:
`analyseFrame` and its `HologramFrameState`, the per-fragment helpers
(`readFragment`, `fragmentStrength`, `placeFragment`, `swirlFragment`,
`latticeFragment`, `scanned`, `densityRowsEnd` and the rest), the body's and
the stream's row layouts, and the constants they read; and the frame clock.
`analyseFrame` reads nothing of the scene but its script (`HologramScript`), so a
frame callback that only analyses frames can capture that rather than the whole
scene.

**Fading him from outside the drawing.** The drawing fades him in and out
through a layer of its own, at `arrivalOf(appearance, presence)` — the arrival
`analyseFrame` works out, exported so nothing keeps a copy of it that drifts. A
view that lays a body drawn on the GPU beside the Skia picture cannot fade the
two separately: Screen-blending two faded layers is brighter where they overlap
than fading the blend of them. So `drawHologram(…, fadeOutside)` skips that layer
and the view fades the group of both by `arrivalOf` instead — the GPU body in
it drawn with `fade: 1`, or it would come out at the arrival squared — which
over black or over nothing comes out within a few levels of the layer's own fade
(`hologram-drawing.spec.ts` holds it to four). At rest there is no layer, and the
two draw the same bytes. The drawing never paints a background — the view does,
with `drawColor` inside its own layer — so leaving one out is the view's to do.

The frame clock is one implementation, `frame-clock.ts`, stepped by both: a
state made once (`createFrameClockState`), the gate that holds back a step
under `MINIMUM_FRAME_SECONDS` (`frameStepSeconds`), the step itself
(`advanceFrameClock`), the arrival's restart (`restartArrival`) and the frame
the drawing is handed (`hologramFrameOf`), with the numbers it runs by in
`frame-timing.ts`. The view calls them inside its frame callback's
`frame.modify`; the headset's `vr/src/hologram3d/frame-clock.ts` wraps
them and keeps only what it does differently, which is when rather than
what — it reads the voice on the clock's own time instead of on a JS-thread
timer, and restarts the arrival on every summon instead of on coming back to
the foreground. Because the step runs every frame under Hermes with no JIT,
it takes the readings as positional arguments, allocates nothing, and must
stay a worklet over that one state object. `frame-clock.spec.ts` keeps a
frozen copy of the view's loop as it was before it was shared and steps both
side by side, so a change to the step that alters the phone's frames by as
much as the last bit fails there.

Its conversation is the same session the phone and the watch hold theirs in
(`createJarvisSession`, see "One conversation, three devices"), called
directly: the headset hands it its browser parts — his track analysed on the
app's `AudioContext`, the greeting's `<audio>` element, the orphaned audio a
dropped call leaves on a page that lives for hours — through
`createHeadsetSession` in `vr/src/conversation/`. A renderer drawing over CanvasKit — the headset's flat layer, and the phone's own web build —
takes its resources from `createReleasableHologramResources` and calls `release()` once each
frame has been flushed or recorded: CanvasKit's objects live in the WebAssembly heap, which nothing
garbage-collects, and the drawing makes a few dozen paths a frame. On a device the JSI objects free
themselves and the view keeps the plain `createHologramResources`. `roomOfConversation`
takes each app's own `Room` guard rather than importing `livekit-client`,
because an `instanceof` is only true against the copy the app's SDK built the
room from.

## His body on the GPU, on a phone and a watch

The view draws his body — the thousands of fragments and their halos — on the
GPU by default, with `hologram/gpu`'s renderer through expo-gl, and leaves the
rest of him to Skia's picture, drawn at density nought. That is what turns him
in three dimensions with the tilt (below), and it takes the body's strokes off
the picture, which was most of what every frame cost. Skia's body is the
fallback, unchanged.

**Where it is tried.** `body` on the view, `'gpu'` unless a screen says
`'skia'`, fixed when the view mounts (`gpuBodyWanted`): on Android 10 or later
with expo-gl's native module in the build, or in a browser with WebGL 2. Below
Android 10 React Native ignores `mixBlendMode`, which is how the two canvases are
composed, so those phones keep Skia's body. The apps force Skia's body with
`body="skia"`: the phone's web build on `?flat` (the headset's name for its flat
mode), and both apps' native builds when bundled with
`EXPO_PUBLIC_HOLOGRAM_BODY=skia`.

**One view tree, on a device and in a browser.** The outer view paints the
background, and where the group is Screened onto it is isolated too: a view with
nothing but a background colour is flattened away on Fabric, and the Screen
would take the nearest view that groups anything as its backdrop — in the
conversation sheet the pressable that fills it, which drew the Screen through
two sheet-sized layers. Inside it the scaled view (`DRAWN_RESOLUTION`) is the
group the two canvases are composed in: isolated, rendered into a texture of its
own at the drawn size on Android (`renderToHardwareTextureAndroid`), faded by
the arrival (`arrivalOf`, written each frame), and on a background that is not
black — the sheet's ink — Screened onto it. In it, Skia's canvas (test id
`hologram-flat`, on a view round it, since Skia's web canvas takes no test id)
is a `TextureView` whatever `opaque` says — for as long as the view is mounted,
even once Skia has taken the body back, since a `SurfaceView` swapped in
mid-show starts black with the cover already lifted — draws no background and
calls `drawHologram` with `fadeOutside`; the GPU's canvas over it
(`hologram-body`, `pointerEvents` none) is Screened onto it with `mixBlendMode:
'screen'` by a view round it, and the GPU body is drawn with `fade: 1` and
`alphaFromLight: 1`. That view shows the canvas only while the layer (below) is
`gpu`: a context that has gone leaves its canvas behind, which a browser paints,
the next time the page is laid out, as its own lost-context placeholder — a
white square, all there was of him once Screened — and which a device may go on
showing as the last frame it was handed. The satellites are in Skia's picture,
so they arrive and leave with him there, where the flat drawing's own fade never
reached them. Without the GPU's canvas Skia paints the background and fades him
itself, as it always did, and only a view that never tried the GPU puts Skia's
canvas on a `SurfaceView` when told it is `opaque`.

**Which renderer, frame by frame** (`body-layer.tsx`). A layer of `pending`,
`gpu` or `skia` (`BodyLayer`, in `body-layer.ts`) lives in a shared value:

- **Pending** on mounting and on every return to the foreground, while the GL
  view is there: the frame callback holds his clock at the start of the
  arrival, where nothing of him shows, until the context is ready — then the
  body is the GPU's — or `GPU_READY_TIMEOUT_MS` (800) has passed, and he arrives
  with Skia's. A GPU body that comes up later is used at the next arrival.
- **Skia's for the mount, and the GL view gone**, when the context is WebGL 1 or
  OpenGL ES 2, `createGpuBody` throws (logged with its reason), the GL view
  throws (an error boundary round it), or `getError` says the warm-up frame
  went wrong — asked once per context, on the JS thread before the handover,
  since it waits for the GPU.
- **Skia's from the next frame** when the context goes while he is on screen:
  expo-gl answers a call on a context that has gone with `undefined`, and a
  browser's `webglcontextlost` drops it from `gl-context.web.ts`'s registry. The
  GPU has the body back at the next arrival if a context has come back by then.
- **The density loop starts again** whenever the body changes renderer, from
  `bodyStartingShare`: Skia's where it always has, from half of what it was last
  seen holding or the floor, and the GPU's at `GPU_STARTING_SHARE` (half)
  whatever was remembered. `createDensityControl` is a worklet for that.
- **Only Skia's proven share is remembered** (`keepsProvenShare`): the view
  writes `provenShare` only while Skia draws the body. The GPU's build time
  always says there is room, so its loop climbs to whatever the frame rate
  allows, often every particle, and a later fallback to Skia started from half
  of that would build far more than Skia's body can through the arrival.

**Set up on the JS thread, drawn on the UI thread, and never both.** expo-gl
lets the JS runtime and the UI runtime share a context, and records the calls of
both into one batch with no lock, so a GL call from each at once is a native
crash rather than an exception. `onContextCreate` runs on the JS thread: it
checks for WebGL 2, calls `createGpuBody` — its compile and link checks wait for
the GPU, which is fine there — draws one frame at density nought so the driver
finishes compiling while he is still pending, calls `endFrameEXP`, and waits for
that frame with `getError`, so the UI thread's first `flushEXP` finds it done
rather than holding up Android's main thread for it. Then it
hands the body, plain data with `{ id }` handles, to the UI thread through a
shared value with the context's id, and never calls GL again; nothing is deleted
by hand, the objects go with the context. The frame callback finds the context
by id (`getWorkletContext`, which needs `enableExperimentalWorkletSupport` and
Reanimated's `_WORKLET_RUNTIME`) and draws on the clock it has just stepped, so
the body and the picture are of the same moment. In a browser everything is on
the page's thread, and `gl-context.web.ts` keeps the contexts in a map of its own;
`gl-contract.ts` types what the two halves of `gl-context` hand the body layer, so
neither can drift from the other.

**`flushEXP` is the back-pressure.** expo-gl queues each frame's calls without
limit, and its GL thread runs every queued frame before it swaps once, so a GPU
that falls behind would be handed more and more frames while the UI thread went
on counting sixty a second. Each GPU frame starts with `flushEXP`, which blocks
until the GL thread has run the previous one, so the frame rate the density loop
measures is the rate frames reach the screen; that wait is the GPU's and is not
counted as build time. What is counted is the picture plus issuing the GPU's
frame — well under a millisecond — so the build time always says there is room
and the frame rate's ceiling is what holds the share down. A browser throttles
its frames itself and needs none.

The phone's and the watch's sample readouts end with `gpu` or `2d`
(`describeFrameRate`), from the view's `bodyLayer`.

What none of this has been seen doing on a device: expo-gl's worklet support on
the UI runtime with this Reanimated, Android composing the two `TextureView`s
with Screen in the same frame, how long `flushEXP` waits on a phone's or a
watch's GPU, how long the pending hold lasts on a first launch, and whether the
assistant's window loses its context between summonings. The phone's web build
in Chromium exercises the rest.

## Tilt to look around, on the phone

`tilt.ts` turns the phone's gravity — Reanimated's GRAVITY sensor, read every
`TILT_SENSOR_INTERVAL_MS` — into where the eye is round him (`tiltFront`) and how
far away it is (`tiltEyeSquares`), for a body drawn in three dimensions. It is
built like the frame clock: one state made once (`createTiltState`), stepped once
a frame inside `modify` with the reading as positional arguments
(`advanceTilt`), and put back as new on coming to the foreground (`resetTilt`);
it allocates nothing, and the front is written into the state's own array.

- **A phone held still shows him straight on.** The rest pose follows gravity
  over `TILT_REST_SECONDS`, so only a change of how it is held turns him, for a
  moment.
- **The turn from rest becomes a tip and a swing**, less a soft deadband, no
  further than `TILT_LARGEST_DEGREES` round him, eased over `TILT_EASE_SECONDS`.
  Gravity cannot see a turn about the vertical, so on an upright phone looking
  sideways is the steering-wheel roll.
- **Not while he listens.** The step takes the frame clock's `hearing` and scales
  the tilt down by it: the listening lattice snaps in the plane facing the eye,
  and about 7% of its lit fragments jump to another knot for every degree the
  view turns.
- **No reading, a reading that is not a number, or a phone on its side** sends
  the eye back to the front, and the next usable reading is the new rest pose, so
  nothing jumps when readings come back.
- **The eye is `PHONE_EYE_DISTANCE` of his resting radii away while readings
  arrive**, and infinitely far — exactly the flat drawing's view — while none do,
  eased between the two over `EYE_DISTANCE_FADE_SECONDS`. The watch and a desktop
  browser never step it, and stay infinitely far.
- **It is handed out in sides of the drawing's square** (`PHONE_EYE_SQUARES`), the
  unit `placeFlatCamera` takes it in, so that as he swells with his voice he grows
  towards the eye rather than the eye backing off with him. The camera draws an eye
  `ORTHOGRAPHIC_EYE_DISTANCE` radii off or further flat: float32 depth cannot hold
  one that far, and the fade back out ends on a remainder that puts it there.

The view steps it only while the GPU draws the body and its `tilt` prop is set,
from `TiltSensor` (`tilt-sensor.tsx`): Reanimated's GRAVITY sensor at
`TILT_SENSOR_INTERVAL_MS`, mounted only while the app is in front and the GPU
body's view is there, since nothing else unregisters it. Its front, taken as the
eye's direction in the screen's own frame, gives the view basis
(`viewBasisTowards`), and `tiltEyeSquares` goes straight to `placeFlatCamera`.

`tilt.spec.ts` holds it to that on gestures stepped at 60 and 120 frames a second.
How it feels — the sign of each gesture, the gain, the deadband — is a device's to
judge.

## Tests

`bunx turbo test --filter=hologram` — headless, offline, no device. The suite
pins the picture itself: byte-identical frames for a given time and voice,
containment inside the canvas, how much the sphere swells and brightens when
spoken to, and that no state leaks between frames.

`particle-loop.spec.ts` holds the hand-written particle loops to a frozen copy
of the ones they replaced, composed from the helpers, in the pattern of
`frame-clock.spec.ts`: every state the loops branch on, at densities from none
to all, in the phone's scene and the watch's, at times from 0 to past where the
clocks stop being floored by truncation (2^29 s), negative, NaN and infinite,
built both ways into builders kept between frames, with `Object.is` on every
number of every command. A change that moves one bit of one command fails there.

What it cannot see is speed on a device. CanvasKit here rasterises on the CPU,
under Bun's JavaScript engine with its JIT, and a phone or a watch does neither.
It paints on the GPU, where which of Skia's path renderers takes a stroke
depends on whether the canvas has a stencil — see `DRAWN_IN_A_LAYER` in
`src/react/hologram-view.tsx`, which lives in the view and so is exercised by no
test here — and it builds the picture under Hermes with no JIT, which on a
desktop harness cost about twelve times per particle what V8 with its JIT pays.
A headless millisecond says which way the pixels went, not how fast Jarvis will
be. Judge a change made for speed on a device, with sample mode's readout of the
frame rate and the build time.

The on-device check that goes with it lives in the phone app
(`mobile/.scripts/verify-hologram-on-emulator.sh`) because it needs an emulator.
Its thresholds are pre-registered; do not adjust them to get a pass.
