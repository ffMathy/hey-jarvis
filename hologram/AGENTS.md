# Hologram

Jarvis's sphere, and the voice tracking that drives it. Shared by every app that
draws him — today `mobile/` and `wear/`.

## The rule that makes this package work

**Nothing here imports a value.** The only imports in the whole package are
`import type`, and there are two of them, both from `@shopify/react-native-skia`.
That is not tidiness; it is the reason the same drawing runs in three places:

- native Skia, on a phone or a watch;
- CanvasKit, in the browser build published to GitHub Pages;
- CanvasKit headless, in `hologram-drawing.spec.ts` and the contact sheets.

`hologram-drawing.ts` takes the Skia factory and the canvas as arguments, typed
as `HologramSkia` and `HologramCanvas` — `Pick<>`s of the real types naming only
the calls it makes. Adding a call means widening those picks, which is the point:
the type says exactly how much of Skia the hologram needs.

If you find yourself wanting to import React, a hook, `react-native`, or anything
that reads a clock or a microphone, it belongs in the app, not here.

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
