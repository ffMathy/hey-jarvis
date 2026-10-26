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
arrives after a wait of at most 800 ms. Like the phone it passes `tilt`, so turning the wrist turns
the view round him (see "Tilt to look around" in [`.claude/rules/hologram-tilt-to-look-around-on-the-phone-and-the-watch.md`](hologram-tilt-to-look-around-on-the-phone-and-the-watch.md)).

**He is drawn at the screen's full resolution** (`WATCH_DRAWN_RESOLUTION` in `watch-screen.ts`), where
the phone draws at 0.45 and scales up. The watch's sphere is about half the phone's in pixels, so at
the phone's share each spark was a pixel or less wide and the scale-up smeared it; the user saw him
as smudgy next to the phone. What drawing every pixel costs the watch's GPU has not been measured: if
it costs frames, the density loop sheds particles rather than sharpness.

**Its ceiling is the phone's** (`PARTICLE_COUNT`, 10,000): the watch's screens leave `particleCount`
at its default, and `WATCH_PACE`'s thirty frames a second decides how much of it a watch draws. The
cost no loop can steer away from is building that scene when the view mounts, twice what the watch's
own 5,000 cost, so a later arrival is the first thing to look for.

The view behind both canvases paints the black. The halo target is sized to the canvas, a texel to a
pixel, rather than the headset's 512 a side.

Read off the watch's Android bundle, exported unminified and without bytecode, the GPU body's
UI-thread code compiles into worklets exactly as the phone's does, and autolinking links `ExpoGL` here
too; the phone's notes ("His body on the GPU" in [`.claude/rules/mobile-his-body-on-the-gpu-and-tilting-the-phone-to-look.md`](mobile-his-body-on-the-gpu-and-tilting-the-phone-to-look.md)) say what
was checked. None of it has run on a watch.
