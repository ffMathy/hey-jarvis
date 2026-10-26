---
paths:
  - "hologram/**"
---

# A second renderer: the headset

> Part of [Hologram](hologram.md). Paths in it are relative to `hologram/` unless they say otherwise.

The headset draws the body in three dimensions on the GPU and the rest of him
with CanvasKit, as the phone and the watch do with Skia, and every device's body
is composed from the per-fragment helpers. The GPU half — the fragment arithmetic
and its CPU reference, the rows, and the halo union, strokes and halos' light —
is `hologram/gpu`, which the headset draws through three.js and a phone or a
watch through `drawGpuBody`. So the main entry exports what that needs:
`analyseFrame` and its `HologramFrameState`, the per-fragment helpers
(`readFragment`, `fragmentStrength`, `placeFragment`, `swirlFragment`,
`latticeFragment`, `scanned`, `densityKey` and the rest), the body's and the
stream's row layouts, and the constants they read; and the frame clock. The
picture itself is drawn from `pictureSceneOf(scene)`, the scene without the
body's and the stream's rows, so a picture worklet never carries them.
`analyseFrame` reads nothing of the scene but its script (`HologramScript`), so a
frame callback that only analyses frames can capture that rather than the whole
scene.

**Fading him from outside the drawing.** The drawing fades him in and out
through a layer of its own, at `arrivalOf(appearance, presence)` — the arrival
`analyseFrame` works out, exported so nothing keeps a copy of it that drifts.
The phone's view, which lays the body drawn on the GPU beside the Skia picture,
cannot fade the two separately: Screen-blending two faded layers is brighter where they overlap
than fading the blend of them. So `drawHologram(…, fadeOutside)` skips that layer
and the view fades the group of both by `arrivalOf` instead — the GPU body in
it drawn with `fade: 1`, or it would come out at the arrival squared — which
over black or over nothing comes out within a few levels of the layer's own fade
(`hologram-drawing.spec.ts` holds it to four). At rest there is no layer, and the
two draw the same bytes. The drawing never paints a background — the view does,
with `drawColor` inside its own layer — so leaving one out is the view's to do.

The frame clock is one implementation, `frame-clock.ts`, stepped by both: a
state made once (`createFrameClockState`), the gate that holds back a step
under `MINIMUM_FRAME_SECONDS` (`frameStepSeconds`), the step itself
(`advanceFrameClock`), the arrival's restart (`restartArrival`) and the frame
the drawing is handed (`hologramFrameOf`), with the numbers it runs by in
`frame-timing.ts`. The view calls them inside its frame callback's
`frame.modify`; the headset's `vr/src/hologram3d/frame-clock.ts` wraps
them and keeps only what it does differently, which is when rather than
what — it reads the voice on the clock's own time instead of on a JS-thread
timer, and restarts the arrival on every summon instead of on coming back to
the foreground. Because the step runs every frame under Hermes with no JIT,
it takes the readings as positional arguments, allocates nothing, and must
stay a worklet over that one state object. `frame-clock.spec.ts` keeps a
frozen copy of the view's loop as it was before it was shared and steps both
side by side, so a change to the step that alters the phone's frames by as
much as the last bit fails there.

Its conversation is the same session the phone and the watch hold theirs in
(`createJarvisSession`, see "One conversation, three devices"), called
directly: the headset hands it its browser parts — his track analysed on the
app's `AudioContext`, the greeting's `<audio>` element, the orphaned audio a
dropped call leaves on a page that lives for hours — through
`createHeadsetSession` in `vr/src/conversation/`. A renderer drawing over CanvasKit — the headset's view-plane picture, and the phone's own web build —
takes its resources from `createReleasableHologramResources` and calls `release()` once each
frame has been flushed or recorded: CanvasKit's objects live in the WebAssembly heap, which nothing
garbage-collects, and the drawing makes a few dozen paths a frame. On a device the JSI objects free
themselves and the view keeps the plain `createHologramResources`. `roomOfConversation`
takes each app's own `Room` guard rather than importing `livekit-client`,
because an `instanceof` is only true against the copy the app's SDK built the
room from.
