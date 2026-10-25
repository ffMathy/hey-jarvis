---
paths:
  - "hologram/**"
---

# Tests

> Part of [Hologram](hologram.md). Paths in it are relative to `hologram/` unless they say otherwise.

`bunx turbo test --filter=hologram` — headless, offline, no device. The suite
pins Skia's picture of everything but his body: byte-identical frames for a
given time and voice, containment inside the canvas, how the sphere moves when
spoken to, and that no state leaks between frames. His body is pinned through
its CPU reference (`gpu/fragment-3d.spec.ts`: where every fragment lands, the
lattice's layers and knots, the thinking plane climbing), and the GPU's passes
against a context that writes its calls down (`gpu/gpu-body.spec.ts`); whether
the GPU's pixels agree is vr's browser tests' to say.

`crescent-loop.spec.ts` holds the hand-written crescent loop to a frozen copy of
the one it replaced, in the pattern of `frame-clock.spec.ts`: every state the
loop branches on, in the phone's scene and the watch's, at times from 0 to far
past an hour, negative, NaN and infinite, built both ways into builders kept
between frames, with `Object.is` on every number of every command.

What it cannot see is speed on a device. CanvasKit here rasterises on the CPU,
under Bun's JavaScript engine with its JIT, and a phone or a watch does neither:
it paints on the GPU, and builds the picture under Hermes with no JIT, which on a
desktop harness cost about twelve times per particle what V8 with its JIT pays.
A headless millisecond says which way the pixels went, not how fast Jarvis will
be. Judge a change made for speed on a device, with sample mode's readout of the
frame rate and the build time.

The on-device check that goes with it lives in the phone app
(`mobile/.scripts/verify-hologram-on-emulator.sh`) because it needs an emulator.
Its thresholds are pre-registered; do not adjust them to get a pass.
