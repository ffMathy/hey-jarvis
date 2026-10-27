---
paths:
  - "hologram/**"
---

# A second renderer: the headset

> Part of [Hologram](hologram.md). Paths in it are relative to `hologram/` unless they say otherwise.

The headset draws all of him on the GPU, as the phone and the watch do: the body
in three dimensions, and the rest of him — the picture — flat, on a quad in his
view plane. Every device's body is composed from the per-fragment helpers. Both
halves are `hologram/gpu`: the headset wraps the body's shader sources in three.js
materials and draws the picture with `drawGpuPicture` into a render target on
three.js's own context (`vr/src/hologram3d/picture-target.ts`), and a phone or a
watch draws both with `drawGpuFrame`. So the main entry exports what that needs:
`analyseFrame` and its `HologramFrameState`, the per-fragment helpers
(`readFragment`, `fragmentStrength`, `placeFragment`, `swirlFragment`,
`latticeFragment`, `scanned`, `densityKey` and the rest), the body's and the
stream's row layouts, and the constants they read; and the frame clock. The
picture itself is drawn from `pictureSceneOf(scene)`, the scene without the
body's and the stream's rows, so a picture worklet never carries them.
`analyseFrame` reads nothing of the scene, so a frame callback that only analyses
frames captures none of it.

**Fading him from outside the drawing.** The GPU draws him unfaded, and whoever
shows him fades him by `arrivalOf(appearance, presence)` — the arrival
`analyseFrame` works out, exported so nothing keeps a copy of it that drifts. A
phone or a watch fades its one canvas by it; the headset fades its passes and
the picture's quad by it (times its close-range fade) through the blend's
constant colour. Fading the body and the picture each before Screening them
together would come out brighter where they overlap than fading them as one, so
neither renderer does. Nothing in the drawing paints a background either: that
is the view's.

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
`createHeadsetSession` in `vr/src/conversation/`. `roomOfConversation`
takes each app's own `Room` guard rather than importing `livekit-client`,
because an `instanceof` is only true against the copy the app's SDK built the
room from.
