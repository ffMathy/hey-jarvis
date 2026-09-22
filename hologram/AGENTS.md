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
| `hologram/conversation` | React, `@elevenlabs/react-native` | his voice as the SDK hears it, and which of his tool calls are in flight |

`hologram/conversation` deliberately does **not** reach Skia. That is what lets
a screen open a conversation before CanvasKit has finished loading in a browser,
which is the case `mobile/src/jarvis-hologram.web.tsx` exists to handle — and it
is why the conversation hooks are not simply part of `hologram/react`.

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

`src/conversation/` is where `@elevenlabs/react-native` is called for real, and
it is thinner still: two flags out of the conversation's own state, two readers
out of the SDK's analysers, and a list of the tool call ids still in flight.

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

**Sample mode is shared, and only sample mode has a readout.** Both devices have one — the phone's
before there is an account, the watch's while it waits for the phone — so the moods, their order,
their names and the readout's text live in `sample-mode.ts`, and the voice hook, the mood toast and
the frame-rate readout in `hologram/react/sample`. Each component takes a `style`: where it sits is
the app's decision, since a round watch face and a phone sheet want different places. The
conversation screens show no frame rate and no particle count on either device.

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

The on-device check that goes with it lives in the phone app
(`mobile/.scripts/verify-hologram-on-emulator.sh`) because it needs an emulator.
Its thresholds are pre-registered; do not adjust them to get a pass.
