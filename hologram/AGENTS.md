# Hologram

Jarvis's sphere, and the voice tracking that drives it. Shared by every app that
draws him — today `mobile/` and `watch/`.

## Two entry points

```
hologram          the design and the voice tracking — no framework in it
hologram/react    the same sphere as a React Native view you can render
```

The split is the whole architecture of this package, and the rule below is why
it exists. Reach for `hologram` when you want to know what Jarvis looks like or
how loud someone is; reach for `hologram/react` when you want him on a screen.

## The rule that makes this package work

**Nothing in the main entry imports a value.** The only imports across
`hologram-drawing.ts`, `voice-levels.ts`, `voice-analysis.ts` and
`voice-contract.ts` are `import type`, and there are two of them, both from
`@shopify/react-native-skia`. That is not tidiness; it is the reason the same
drawing runs in three places:

- native Skia, on a phone or a watch;
- CanvasKit, in the browser build published to GitHub Pages;
- CanvasKit headless, in `hologram-drawing.spec.ts` and the contact sheets.

`hologram-drawing.ts` takes the Skia factory and the canvas as arguments, typed
as `HologramSkia` and `HologramCanvas` — `Pick<>`s of the real types naming only
the calls it makes. Adding a call means widening those picks, which is the point:
the type says exactly how much of Skia the hologram needs.

`src/react/` is where React, Reanimated and Skia are called for real, and it is
deliberately thin: a Skia canvas, a frame callback, the voice read every 40 ms,
and the tracker stepped on the UI thread. It takes a `JarvisVoice` and asks it
two questions — nothing in it knows where the audio came from, so the phone can
hand it a WebRTC track and the watch its own microphone.

If you find yourself wanting a microphone, a permission prompt, a navigation
decision or a screen layout in either place, it belongs in the app, not here.

`simulated-voice.ts` is the one place with no `'worklet'` on anything, and that is deliberate: it
is read where a voice is read — the JS thread, every 40 ms — and never on the UI thread. It makes
up the two voices sample mode can show without a microphone, Jarvis speaking and Jarvis working,
as spectra, so they go through every step a real voice does and nothing downstream can tell.

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
