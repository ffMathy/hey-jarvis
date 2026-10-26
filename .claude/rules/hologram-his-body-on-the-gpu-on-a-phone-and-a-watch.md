---
paths:
  - "hologram/**"
---

# Him on the GPU, on a phone and a watch

> Part of [Hologram](hologram.md). Paths in it are relative to `hologram/` unless they say otherwise.

The view draws all of him on the GPU, with `hologram/gpu` through expo-gl, into
one canvas: the picture of everything but his body (`createGpuPicture`,
`drawGpuPicture`) and his body — the thousands of fragments and their halos —
over it (`createGpuBody`, `drawGpuBody`), as one frame (`drawGpuFrame`). That is
what turns his body in three dimensions with the tilt (below). **There is no
other renderer.** Skia drew the picture until the GPU drew all of him, and the
2D body before that; neither is kept as a fallback or behind a switch.

**What each platform gets.**

- **A phone or a watch**: the GPU. Both apps require Android 10 or later
  (`minSdkVersion` 29 on the phone, 30 on the watch), the first on which React
  Native honours `mixBlendMode`, which is how he is Screened onto a background
  that is not black.
- **A browser with WebGL 2**: the GPU, on a `<canvas>` of expo-gl's, with a
  depth and a stencil buffer (`gl-context.web.ts`), which the picture needs.
- **No GL view at all** — a browser without `WebGL2RenderingContext`, or a
  development client built before expo-gl's native module was in it
  (`BodyGlView` undefined in `gl-context.ts`): nothing of him. Nothing is
  pending, and the density loop runs as ever.
- **A GL view that cannot draw him** — a WebGL 1 or OpenGL ES 2 context, a
  `createGpuBody` or `createGpuPicture` that throws (logged with its reason), a
  GL view that throws (an error boundary round it), or a warm-up frame
  `getError` says went wrong: the GL view goes for the mount, he is not drawn,
  and nothing else changes.
- **A context lost mid-show** — expo-gl answering a call on it with `undefined`,
  a browser's `webglcontextlost` dropping it from `gl-context.web.ts`'s
  registry: he is gone from the next frame, until expo-gl hands a new context to
  `onContextCreate` (a browser's `webglcontextrestored`, a device's new
  surface), which sets him up afresh and draws him from the frame after.

**One view tree, on a device and in a browser.** The outer view paints the
background, and where he is Screened onto it is isolated too: a view with
nothing but a background colour is flattened away on Fabric, and the Screen
would take the nearest view that groups anything as its backdrop — in the
conversation sheet the pressable that fills it, which drew the Screen through
two sheet-sized layers. Inside it the scaled view (`drawnResolution`: 0.45 on a
phone, 0.6 on a watch) holds the GL canvas (test id `hologram-canvas`,
`pointerEvents` none): rendered into a texture of its own at the drawn size on
Android (`renderToHardwareTextureAndroid`), faded by the arrival (`arrivalOf`,
written each frame), and on a background that is not black Screened onto it.
The GPU draws him unfaded (`fade: 1`, `alphaFromLight: 1`), body and picture
together, so the view's one fade is the whole of his arrival. The canvas shows
only while the layer (below) is `drawn`: a context that has gone leaves its
canvas behind, which a browser paints, the next time the page is laid out, as
its own lost-context placeholder — a white square, all there was of him once
Screened — and which a device may go on showing as the last frame it was
handed. The satellites are in the picture, so they arrive and leave with him.

**Whether he is drawn, frame by frame** (`gpu-layer.tsx`). A layer of
`pending`, `drawn` or `absent` (`GpuLayer`) lives in a shared value:

- **Pending** on mounting and on every return to the foreground, while the GL
  view is there. His arrival is his body spiralling out of the core, so the
  frame callback holds his clock at the start of it, where nothing of him shows,
  until the GPU is ready or `GPU_READY_TIMEOUT_MS` (800) has passed. The wait
  is kept for that first frame, and bounded so nothing can hang on it.
- **Drawn or absent** after that, decided every frame by whether a context and
  what was made in it are there (`drawingThisFrame`): a GPU that comes up after
  the wait draws him from the frame it is ready, wherever the arrival has got to.
- **The density loop** starts once a mount at `STARTING_SHARE` (half), and
  nothing is remembered between mounts: the build time always says there is room
  with all of him on the GPU, so the frame-rate ceiling is what holds the share.
- **A frame draws only the share's quads.** The index lists every row's quad in
  the order of its density key (`buildRowVertices`), so the rows a share keeps are
  the index's first, and `drawGpuBody` draws just those (`quadsKept`) in both
  passes. It used to draw them all and let the shader hide the rest, so at the
  loop's floor a frame still shaded nearly every vertex of the scene: on
  SwiftShader at the watch's 340 pixels, 21.3 ms a frame at a share of 0.025
  against 5.4 ms for the share alone. The headset draws the same index, so the
  two renderers still match to the byte.

**A path paints each pixel once, at the most it covers it.** Skia stroked a
path once, so where its pieces overlap — a polyline's joins, a crescent's
strands — the overlap is not lit twice. The picture draws a path as many shapes,
so `drawShapes` draws each twice: first only into the depth buffer, each
fragment nearer the more it covers, then in colour where the depth is equal,
with a stencil value of the path's own stopping a tie painting twice. Painting
the first fragment to arrive instead left a dark seam inside overlapping
strokes, wherever a faint antialiased edge reached a pixel before the stroke
lying over it. Each path draws in a band of depths nearer than every earlier
one's (`PATH_DEPTH_SPAN`), so the depth and stencil buffers are cleared once a
frame, with the colour; expo-gl asks Android for 16 bits of depth and 8 of
stencil, which gives each of up to 255 paths 256 steps of coverage.

**Set up on the JS thread, drawn on the UI thread, and never both.** expo-gl
lets the JS runtime and the UI runtime share a context, and records the calls of
both into one batch with no lock, so a GL call from each at once is a native
crash rather than an exception. `onContextCreate` runs on the JS thread: it
checks for WebGL 2, calls `createGpuBody` and `createGpuPicture` — their compile
and link checks wait for the GPU, which is fine there — draws one frame of all of
him at density nought so the driver finishes compiling while he is still
pending, calls `endFrameEXP`, and waits for that frame with `getError`, so the UI
thread's first `flushEXP` finds it done rather than holding up Android's main
thread for it. Then it hands the body and the picture, plain data with `{ id }`
handles, to the UI thread through a shared value with the context's id, and never
calls GL again; nothing is deleted by hand, the objects go with the context. The
frame callback finds the context by id (`getWorkletContext`, which needs
`enableExperimentalWorkletSupport` and Reanimated's `_WORKLET_RUNTIME`) and draws
on the clock it has just stepped. In a browser everything is on the page's
thread, and `gl-context.web.ts` keeps the contexts in a map of its own;
`gl-contract.ts` types what the two halves of `gl-context` hand the layer, so
neither can drift from the other.

**`flushEXP` is the back-pressure.** expo-gl queues each frame's calls without
limit, and its GL thread runs every queued frame before it swaps once, so a GPU
that falls behind would be handed more and more frames while the UI thread went
on counting sixty a second. Each GPU frame starts with `flushEXP`, which blocks
until the GL thread has run the previous one, so the frame rate the density loop
measures is the rate frames reach the screen; that wait is the GPU's and is not
counted as build time. What is counted is issuing the GPU's frame — well under a
millisecond — so the build time always says there is room and the frame rate's
ceiling is what holds the share down. A browser throttles its frames itself and
needs none.

What none of this has been seen doing on a device: expo-gl's worklet support on
the UI runtime with this Reanimated, the picture's depth and stencil on a
phone's or a watch's GPU, how long `flushEXP` waits there, how long the pending
hold lasts on a first launch, and whether the assistant's window loses its
context between summonings. The phone's web build in Chromium exercises the
rest, and vr's `hologram-picture.spec.ts` holds the picture to frames Skia drew.
