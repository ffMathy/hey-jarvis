# Hologram

Jarvis himself: the sphere, the voice tracking that drives it, and the
conversation with the agent doing the talking. Shared by every app that *is*
him — `mobile/` and `watch/`, and `horizon/`, the Quest headset app that stands
him in your room, which uses only the main entry and the assets.

> **Note:** See the root [AGENTS.md](../AGENTS.md) for shared conventions (Turborepo commands, commit standards, 1Password, etc.)

## Three entry points

```
hologram               the design, the voice tracking, the ElevenLabs credentials, and the
                       conversation's framework-free parts — no framework
hologram/react         the same sphere as a React Native view you can render
                       (plus ./react/lifecycle and ./react/sample, which are Skia-free)
hologram/conversation  the hook a React Native screen holds its conversation with
hologram/assets/*      the files themselves (the greeting, the icons), for a bundler that takes
                       a file as a URL
```

The split is the whole architecture of this package, and the rule below is why
it exists. Reach for `hologram` when you want to know what Jarvis looks like,
how loud someone is, or what it takes to reach his agent; `hologram/react` when
you want him on a screen; `hologram/conversation` when you want him talking.

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
| `hologram` | types, its own siblings, and the plain values of Skia's enums | the drawing and the frame analysis behind it, the frame clock every device steps him on (`frame-clock.ts`) and the numbers it runs by (`frame-timing.ts`), the voice tracker, the simulated voices, sample mode's moods, the voices each mood hands the sphere (`sample-drive.ts`) and its readout text, the density control, the ElevenLabs credentials, how they are stored and the token request, and the conversation itself: the session every device holds it in (`jarvis-session.ts`, its shapes in `session-contract.ts`), what its failures say (`failure-text.ts`), which of his lines it writes down (`written-caption.ts`), the headset's half-duplex fallback (`half-duplex.ts`), what the agent says a request affects (`affected-entities.ts`: the `markAffected` tool's name, its limits and its parser), and the pieces it is built from — whether a conversation is open or has ended and how long to wait for it (`conversation-life.ts`), which tool calls are in flight (`tool-activity.ts`), the latest `vad_score` (`vad-score.ts`), his voice as a browser plays it (`played-voice.ts`), finding his track in the room (`agent-audio-track.ts`), dropping what an interruption leaves queued (`queued-audio.ts`) and his last written line (`written-reply.ts`) |
| `hologram/react` | React, Reanimated, Skia | the Skia canvas and the frame callback that steps the frame clock |
| `hologram/react/sample` | React, Reanimated — not Skia | sample mode's clock-made voice, mood toast and frame-rate readout, shared by the phone's sample screen and the watch's waiting screen |
| `hologram/conversation` | React, `@elevenlabs/client`, `@livekit/react-native`'s audio session, hologram's own native greeting player (`expo-audio` in a browser) — not Skia | `useJarvisSession`, which hands the main entry's session the SDK, the greeting's player and the call's audio, and holds its snapshot for a screen |

`hologram/conversation` deliberately does **not** reach Skia. That is what lets
a screen open a conversation before CanvasKit has finished loading in a browser,
which is the case `mobile/src/jarvis-hologram.web.tsx` exists to handle — and it
is why the conversation hook is not simply part of `hologram/react`.
`react.contract.spec.ts` holds it to that, as it does `./react/lifecycle` and
`./react/sample`.

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

The two ElevenLabs files keep the same rule for the same payoff. `fetch` is a
global rather than an import, so the token request and every failure ElevenLabs
can answer with — a rejected key, a key without permission, an unknown agent, an
account out of credits, a rate limit — are driven in `conversation-token.spec.ts`
with no account, no credential, no SDK and no device.

`hologram-drawing.ts` takes the Skia factory and the canvas as arguments, typed
as `HologramSkia` and `HologramCanvas` — `Pick<>`s of the real types naming only
the calls it makes. Adding a call means widening those picks, which is the point:
the type says exactly how much of Skia the hologram needs.

`src/react/` is where React, Reanimated and Skia are called for real, and it is
deliberately thin: a Skia canvas, a frame callback, the voice read every 40 ms,
and the tracker stepped on the UI thread. It takes a `JarvisVoice` and asks it
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
the 5.3 ms a picture took to build at the floor, on a desktop harness.

`src/conversation/` is where the ElevenLabs SDK is called for real, and it is
thinner still: `useJarvisSession` hands the main entry's session
`Conversation.startSession`, the greeting's player, the call's audio and a
timer, and holds its snapshot in React. Every rule of the conversation is the
main entry's — see below.

If you find yourself wanting a microphone, a permission prompt, a navigation
decision or a screen layout in any of the three, it belongs in the app, not
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
- **The greeting and the token start together** and the session is dialled once
  he has finished (`waitsForGreetingBeforeDialling`, false in a browser, which
  dials behind him muted until he has).

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
`horizon/AGENTS.md`). An infinite wait arms no timer at all: a browser runs a
timer of `Infinity` at once, and the specs' fake clock does the same, so a session
that handed it over would fail in their hands as it would on a page.

Its specs are the headset's (`jarvis-session.spec.ts`,
`jarvis-session-conversation.spec.ts`, set up the way the headset sets it up) and
the phone's and the watch's (`jarvis-session-devices.spec.ts`), all driven by the
fakes in `jarvis-session.fakes.ts`, which fire callbacks in the SDK's own order.

## What he is working on, and what the room tells him

**`markAffected` is answered on every device, by the session.** When a routed
request starts, the agent that took it reports the entities it touches, the
routing agent relays them in its `instructions`, and the voice agent calls its
`markAffected` client tool with them. `createJarvisSession` registers the tool
in both of its option branches (`clientTools`), so the phone, the watch and a
browser holding the conversation in writing answer it without being changed. A
device that left it out would send the agent an error (`is_error`), which the
model reacts to aloud, and `onUnhandledClientToolCall` is no way out: the SDK
then sends no result at all. The tool is bound to the summoning that dialled it,
like every callback, and never throws into the SDK — a throw from the holder is
noted in the diagnostics, and the call is still answered.

An entity is `{ id, name? }` (`affected-entities.ts`). The id is **opaque** — a
Home Assistant light, an email inbox, a calendar, whatever an agent reports —
and is compared, never parsed; the name is for display only. Both are model
output by the time they arrive, so `affectedEntitiesOf` reads the shape
leniently (bare ids, `entityId` for `id`, the array written out as JSON, a lone
entity) and the values strictly: trimmed, non-empty, an id of at most 200
characters and a name of at most 120, no more than 50 per call, each id once,
and anything else left out. A call with something usable in it goes to the
optional `events.onAffected(entities)` — the headset's, which lights them up
where they stand — and answers `Marked.`; one with nothing usable answers so
and tells nobody. The phone and the watch pass no `onAffected`, so nothing on
their screens moves.

**`sendContextualUpdate(text, contextId?)` tells the agent something without
asking it anything** — on the headset, what sir is pointing at. It is sent while
connected (not only live: a browser's conversation is up behind the greeting),
in a `try`, since a socket that is going throws. Before that, the latest update
for each context id waits for the summoning under way and goes the moment it
connects, before the phase moves to `live`, so anything the holder says on
`live` lands after it; whatever is waiting when the summoning ends is dropped,
and with no summoning under way nothing is kept. The server keeps only the
newest update for a context id, which is what the ids are for. The optional
`deviceContext` dependency is said first, under `DEVICE_CONTEXT_ID`, in every
conversation that connects; only the headset passes one, and the agent's prompt
waits for it before calling `markAffected`. Neither is exposed through
`useJarvisSession`: the phone and the watch have nothing to point at.

`jarvis-session.fakes.ts` answers a client tool call the way
`BaseConversation.handleClientToolCall` in `@elevenlabs/client` 1.24.0 does
(`callClientTool`): the `hasOwn` lookup, the handler awaited, nothing returned
becoming "Client tool execution successful.", and a throw or an unregistered
name reported through `onError` and answered as an error.

## Two things about the ElevenLabs half worth knowing before changing it

**The participant name is a required argument, not a default.** Each device
names itself in the ElevenLabs conversation history — `jarvis-android`,
`jarvis-wear` and `jarvis-horizon` — and the point of the names is to be told
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
- **And the session still starts after him, on a device.** The token is fetched beside him, but
  the session is dialled only once the recording is over (`waitsForGreetingBeforeDialling`, which
  `useJarvisSession` sets on a device and not in a browser), and not at all if he was hung up on.
- **In a browser, only while the microphone is held.** A tab nobody has clicked since it loaded
  refuses to play a sound unless the page is using the microphone, so the phone app's web build
  holds the stream it asked permission with until the session says the greeting has started or
  will not (`onGreetingAnswered`). The session waits for the browser's answer, and if it is no the
  greeting is dropped and the agent keeps its own first message, so he is never left not greeting
  at all.

The session's `user` is the `UserVoice` for the listening lattice: presence is only ever the latest
`vad_score` (`vad-score.ts`), ignored while he speaks or greets — the firmware's
`speaker_is_active_` rule, since his voice through the speaker scores as the user's — and volume is
the SDK's input level. Both read zero while the session is not connected or its microphone is muted.

## Hanging up after a finished request

The apps do not decide this. A finished request that is followed by quiet is ended by the agent
itself — its `turnTimeout` of 3 s and its `end_call` tool — so no device registers a client tool
for it, and each sees it as the agent hanging up. (The one client tool there is, `markAffected`, is
the session's; see "What he is working on, and what the room tells him".)

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
with CanvasKit, and it composes him from the same pieces the view does rather
than from copies of them. So the main entry exports what that needs:
`analyseFrame` and its `HologramFrameState`, the per-fragment helpers
(`readFragment`, `fragmentStrength`, `placeFragment`, `swirlFragment`,
`latticeFragment`, `scanned`, `densityRowsEnd` and the rest), the body's and
the stream's row layouts, and the constants they read; and the frame clock.

The frame clock is one implementation, `frame-clock.ts`, stepped by both: a
state made once (`createFrameClockState`), the gate that holds back a step
under `MINIMUM_FRAME_SECONDS` (`frameStepSeconds`), the step itself
(`advanceFrameClock`), the arrival's restart (`restartArrival`) and the frame
the drawing is handed (`hologramFrameOf`), with the numbers it runs by in
`frame-timing.ts`. The view calls them inside its frame callback's
`frame.modify`; the headset's `horizon/src/hologram3d/frame-clock.ts` wraps
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
`createHeadsetSession` in `horizon/src/conversation/`. A renderer drawing over CanvasKit — the headset's flat layer, and the phone's own web build —
takes its resources from `createReleasableHologramResources` and calls `release()` once each
frame has been flushed or recorded: CanvasKit's objects live in the WebAssembly heap, which nothing
garbage-collects, and the drawing makes a few dozen paths a frame. On a device the JSI objects free
themselves and the view keeps the plain `createHologramResources`. `roomOfConversation`
takes each app's own `Room` guard rather than importing `livekit-client`,
because an `instanceof` is only true against the copy the app's SDK built the
room from.

## Tests

`bunx turbo test --filter=hologram` — headless, offline, no device. The suite
pins the picture itself: byte-identical frames for a given time and voice,
containment inside the canvas, how much the sphere swells and brightens when
spoken to, and that no state leaks between frames.

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
