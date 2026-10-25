---
paths:
  - "watch/**"
---

# His body on the GPU

> Part of [Wear OS App](watch.md). Paths in it are relative to `watch/` unless they say otherwise.

The watch draws his body on the GPU, as the phone does: `hologram/gpu`'s renderer through expo-gl, on a
canvas Screened over Skia's picture of the rest of him (see "His body on the GPU" in
[`.claude/rules/hologram-his-body-on-the-gpu-on-a-phone-and-a-watch.md`](hologram-his-body-on-the-gpu-on-a-phone-and-a-watch.md)). It needs Android 10, which every watch this app installs
on has (its `minSdk` is 30), and a GPU that gives OpenGL ES 3. **There is no other body:** on a watch
whose GPU gives ES 2, or whose shaders will not compile, he is drawn without one, and the rest of him
arrives after a wait of at most 800 ms. Unlike the phone it shows him **straight on**: it passes no
`tilt`, so the eye is infinitely far, a flat projection of the body.

The view behind both canvases paints the black. The halo target is sized to the canvas, a texel to a
pixel, rather than the headset's 512 a side.

Read off the watch's Android bundle, exported unminified and without bytecode, the GPU body's
UI-thread code compiles into worklets exactly as the phone's does, and autolinking links `ExpoGL` here
too; the phone's notes ("His body on the GPU" in [`.claude/rules/mobile-his-body-on-the-gpu-and-tilting-the-phone-to-look.md`](mobile-his-body-on-the-gpu-and-tilting-the-phone-to-look.md)) say what
was checked. None of it has run on a watch.
