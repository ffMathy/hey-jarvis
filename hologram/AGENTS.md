# Hologram

Jarvis himself: the sphere, the voice tracking that drives it, and the
conversation with the agent doing the talking. Shared by every app that *is*
him — today `mobile/` and `watch/`.

> **Note:** See the root [AGENTS.md](../AGENTS.md) for shared conventions (Turborepo commands, commit standards, 1Password, etc.)

## Three entry points

```
hologram               the design, the voice tracking, and the ElevenLabs credentials — no framework
hologram/react         the same sphere as a React Native view you can render
                       (plus ./react/lifecycle and ./react/sample, which are Skia-free)
hologram/conversation  the hooks a screen holding an ElevenLabs conversation needs
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
| `hologram` | nothing but types | the drawing, the voice tracker, the simulated voices, sample mode's moods and readout text, the density control, the ElevenLabs credentials and the token request |
| `hologram/react` | React, Reanimated, Skia | the Skia canvas and the frame loop |
| `hologram/react/sample` | React, Reanimated — not Skia | sample mode's clock-made voice, mood toast and frame-rate readout, shared by the phone's sample screen and the watch's waiting screen |
| `hologram/conversation` | React, `@elevenlabs/react-native`, `expo-audio` — not Skia | his voice as the SDK hears it, which of his tool calls are in flight, the recorded greeting he answers with, and the user's voice for the listening lattice |

`hologram/conversation` deliberately does **not** reach Skia. That is what lets
a screen open a conversation before CanvasKit has finished loading in a browser,
which is the case `mobile/src/jarvis-hologram.web.tsx` exists to handle — and it
is why the conversation hooks are not simply part of `hologram/react`.
`react.contract.spec.ts` holds it to that, as it does `./react/lifecycle` and
`./react/sample`.

## The rule that makes this package work

**Nothing in the main entry imports a value.** The only imports across
`hologram-drawing.ts`, `voice-levels.ts`, `voice-analysis.ts`,
`voice-contract.ts`, `sample-mode.ts`, `elevenlabs-settings.ts` and
`conversation-token.ts` are `import type`. That is not tidiness; it is the reason the same drawing runs in
three places:

- native Skia, on a phone or a watch;
- CanvasKit, in the browser build published to GitHub Pages;
- CanvasKit headless, in `hologram-drawing.spec.ts` and the contact sheets.

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

`src/conversation/` is where `@elevenlabs/react-native` is called for real, and
it is thinner still: two flags out of the conversation's own state, two readers
out of the SDK's analysers, a list of the tool call ids still in flight, the
latest `vad_score`, and the greeting's player.

If you find yourself wanting a microphone, a permission prompt, a navigation
decision or a screen layout in any of the three, it belongs in the app, not
here.

## Two things about the ElevenLabs half worth knowing before changing it

**The participant name is a required argument, not a default.** Each device
names itself in the ElevenLabs conversation history — `jarvis-android` and
`jarvis-wear` — and the point of the names is to be told apart, so a
conversation held on the wrist is distinguishable from one held in a pocket.
Both constants are in `conversation-token.ts` and neither is the default,
because a default is how the watch ends up filed under the phone's name.

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
the frame-rate readout in `hologram/react/sample`. Each component takes a `style`: where it sits is
the app's decision, since a round watch face and a phone sheet want different places. The
conversation screens show no frame rate and no particle count on either device.

## Summoned, he greets you before he is connected

`useGreeting` (`src/conversation/greeting.ts`) is the voice firmware's trick on the phone and the
watch: "Hello sir, how can I help?" plays from `assets/greeting.mp3` — the firmware's own recording
— the moment he is summoned, the session is dialled *behind* it, and the agent is told to skip its
first message (`overrides: { agent: { firstMessage: '' } }`, the firmware's `first_message: ""`).
While it plays the sphere follows `createGreetingReaders` at the player's own position, and the
session's microphone is muted from `onConversationCreated` until it ends, so the agent does not hear
Jarvis through the speaker as the user. `isGreetingOver` (`greeting-handover.ts`) decides the end:
the recording's end, or its length plus a grace if playback never started. Three things that are
easy to break:

- **expo-audio must mix, not take focus.** Unless told `mixWithOthers` it requests audio focus, and
  LiveKit's own focus request as the call connects would pause him mid-sentence.
- **Its audio mode is set once, before any session.** On Android `setAudioModeAsync` also writes
  `AudioManager.mode`, and doing it mid-call would take the call out of `MODE_IN_COMMUNICATION`.
- **No greeting where it cannot be heard.** A browser that has had no tap refuses to play, so there
  it is not attempted and the agent keeps its own first message.

`useUserVoice` is the `UserVoice` for the listening lattice: presence is only ever the latest
`vad_score` (`vad-score.ts`), ignored while he speaks or greets — the firmware's
`speaker_is_active_` rule, since his voice through the speaker scores as the user's — and volume is
the SDK's input level. Both read zero while the session is not connected or its microphone is muted.

## Worklets

The drawing and the tracker both run on the UI thread under Reanimated, so every
exported function carries the `'worklet'` directive, helpers are declared before
their callers, and nothing closes over anything but its arguments and
module-level constants. Breaking one of those rules fails at runtime on a device
and nowhere else — the tests call these functions on the JS thread, where a
worklet is an ordinary function.

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
