---
paths:
  - "hologram/**"
---

# His body on the GPU, on a phone and a watch

> Part of [Hologram](hologram.md). Paths in it are relative to `hologram/` unless they say otherwise.

The view draws his body — the thousands of fragments and their halos — on the
GPU, with `hologram/gpu`'s renderer through expo-gl, and leaves the rest of him
to Skia's picture, which never draws a body. That is what turns him in three
dimensions with the tilt (below). **There is no other body.** The 2D one Skia
used to draw is gone, and nothing keeps it as a fallback or behind a switch.

**What each platform gets.**

- **A phone or a watch**: the GPU body. Both apps require Android 10 or later
  (`minSdkVersion` 29 on the phone, 30 on the watch), the first on which React
  Native honours `mixBlendMode`, which is how the two canvases are composed.
- **A browser with WebGL 2**: the GPU body, on a `<canvas>` of expo-gl's.
- **No GL view at all** — a browser without `WebGL2RenderingContext`, or a
  development client built before expo-gl's native module was in it
  (`BodyGlView` undefined in `gl-context.ts`): no body. Nothing is pending, so
  the rest of him arrives on the first frame, and the density loop runs as ever.
- **A GL view that cannot draw him** — a WebGL 1 or OpenGL ES 2 context, a
  `createGpuBody` that throws (logged with its reason), a GL view that throws
  (an error boundary round it), or a warm-up frame `getError` says went wrong:
  the GL view goes for the mount, he is drawn without a body, and nothing else
  changes.
- **A context lost mid-show** — expo-gl answering a call on it with `undefined`,
  a browser's `webglcontextlost` dropping it from `gl-context.web.ts`'s
  registry: the body is gone from the next frame, until expo-gl hands a new
  context to `onContextCreate` (a browser's `webglcontextrestored`, a device's
  new surface), which sets the body up afresh and draws it from the frame after.

**One view tree, on a device and in a browser.** The outer view paints the
background, and where the group is Screened onto it is isolated too: a view with
nothing but a background colour is flattened away on Fabric, and the Screen
would take the nearest view that groups anything as its backdrop — in the
conversation sheet the pressable that fills it, which drew the Screen through
two sheet-sized layers. Inside it the scaled view (`drawnResolution`: 0.45 on a phone, 0.7 on a watch) is the
group the two canvases are composed in: isolated, rendered into a texture of its
own at the drawn size on Android (`renderToHardwareTextureAndroid`), faded by
the arrival (`arrivalOf`, written each frame), and on a background that is not
black — the sheet's ink — Screened onto it. In it, Skia's canvas (test id
`hologram-picture`, on a view round it, since Skia's web canvas takes no test
id) draws no background and calls `drawHologram` with `fadeOutside`; the GPU's
canvas over it (`hologram-body`, `pointerEvents` none) is Screened onto it with
`mixBlendMode: 'screen'` by a view round it, and the GPU body is drawn with
`fade: 1` and `alphaFromLight: 1`. That view shows the canvas only while the
layer (below) is `drawn`: a context that has gone leaves its canvas behind,
which a browser paints, the next time the page is laid out, as its own
lost-context placeholder — a white square, all there was of him once Screened —
and which a device may go on showing as the last frame it was handed. The
satellites are in Skia's picture, so they arrive and leave with him.

**Whether there is a body, frame by frame** (`body-layer.tsx`). A layer of
`pending`, `drawn` or `absent` (`BodyLayer`) lives in a shared value:

- **Pending** on mounting and on every return to the foreground, while the GL
  view is there. His arrival is his body spiralling out of the core, so the
  frame callback holds his clock at the start of it, where nothing of him shows,
  until the body is ready or `BODY_READY_TIMEOUT_MS` (800) has passed. The wait
  is kept for that first frame, and bounded so nothing can hang on it.
- **Drawn or absent** after that, decided every frame by whether a body and a
  live context are there (`bodyThisFrame`): a body that comes up after the wait
  is drawn from the frame it is ready, wherever the arrival has got to.
- **The density loop** starts once a mount at `STARTING_SHARE` (half), and
  nothing is remembered between mounts: the build time always says there is room
  with the body on the GPU, so the frame-rate ceiling is what holds the share.

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

What none of this has been seen doing on a device: expo-gl's worklet support on
the UI runtime with this Reanimated, Android composing the two `TextureView`s
with Screen in the same frame, how long `flushEXP` waits on a phone's or a
watch's GPU, how long the pending hold lasts on a first launch, and whether the
assistant's window loses its context between summonings. The phone's web build
in Chromium exercises the rest.
