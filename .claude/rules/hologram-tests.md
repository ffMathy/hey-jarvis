---
paths:
  - "hologram/**"
---

# Tests

> Part of [Hologram](hologram.md). Paths in it are relative to `hologram/` unless they say otherwise.

`bunx turbo test --filter=hologram` — headless, offline, no device. It has no
GPU, so it pins what can be pinned without one: the scene and what each frame of
him is (`hologram-drawing.spec.ts`), where the satellites are
(`satellite-drawing.spec.ts`), his body through its CPU reference
(`gpu/fragment-3d.spec.ts`: where every fragment lands, the lattice's layers and
knots, the thinking plane climbing), the picture's glyphs and paths flattened
into runs (`gpu/picture-glyphs.spec.ts`, `gpu/picture-layers.spec.ts`), and the
GPU's passes — the body's and the picture's — against a context that writes its
calls down (`gpu/gpu-body.spec.ts`, `gpu/gpu-picture.spec.ts`, both over
`gpu/recording-gl.fakes.ts`).

What he looks like drawn is vr's browser tests' to say, in Chromium on the same
`hologram/gpu`: the body against the headset's three.js to the byte
(`hologram-gpu-body.spec.ts`), the picture against frames Skia drew before it
went (`hologram-picture.spec.ts`), and how the picture behaves — golden, moving,
answering his voice, arriving without a flash, staying inside its square — in
the tests that used to draw it through CanvasKit here
(`hologram-picture-behaviour.spec.ts`).

What none of it can see is speed on a device. SwiftShader in a headless Chromium
rasterises on the CPU, and a phone or a watch has a GPU of its own and builds a
frame under Hermes with no JIT. A headless millisecond says which way the pixels
went, not how fast Jarvis will be. Judge a change made for speed on a device,
with sample mode's readout of the frame rate and the build time.

The on-device check that goes with it lives in the phone app
(`mobile/.scripts/verify-hologram-on-emulator.sh`) because it needs an emulator.
Its thresholds are pre-registered; do not adjust them to get a pass.
