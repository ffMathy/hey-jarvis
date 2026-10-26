---
paths:
  - "vr/**"
---

# How he is drawn (`src/hologram3d/`)

> Part of [VR](vr.md). Paths in it are relative to `vr/` unless they say otherwise.

`src/hologram3d/` stands the phone's Jarvis in the room in three dimensions.
`createJarvisHologram3D(renderer)` is the whole of it for the app:
add `object` to the scene, set its position (the anchor), call `arrive()` on every
summon and `update(delta, drive, centreEye)` once per XR frame before
`renderer.render`, with the centre eye read from `frame.getViewerPose` at the start
of the frame (three's XR camera lags one), and `settle()` when the next second's
frames will hitch for reasons not his (see the backstop below). He is drawn
one way only, all of it on three's own WebGL 2 context: his body in three
dimensions beside the phone's picture of the rest of him.

Per frame, on the CPU:

1. **The phone's clock** (`frame-clock.ts`): hologram's frame clock, the one
   `hologram-view.tsx` steps in its frame callback — `advanceFrameClock` behind the
   `frameStepSeconds` gate, drawn through `hologramFrameOf`: the voice eased per
   frame, the tracker stepped on the raw reading, thinking and leaving faded at
   their fixed rates, the lattice eased. This file keeps only what the headset does
   differently: the voice is read every READ_INTERVAL_MS on the clock's own time,
   and the arrival restarts on `arrive()` (`restartArrival`).
2. **`analyseFrame(frame, 1, scene)`**, which is all the CPU does for the picture:
   what it draws is a few dozen draws' uniforms.

On the GPU, in passes whose shaders, rows and arithmetic are `hologram/gpu`'s —
shared with the phone and the watch, which draw them with no three.js (see
`.claude/rules/hologram.md`) — and which the files here wrap in three.js's
materials, targets and meshes:

3. **The picture** (`picture-target.ts`), once a frame, before either eye:
   `hologram/gpu`'s `drawGpuPicture` — everything flat that the phone draws, the
   whorl, the core, the rim, the truss, the crescent, the fray, the chips, the
   pulse, everything but the body and the stream — into a 512-pixel
   `WebGLRenderTarget` with a depth and a stencil buffer, which the picture needs
   (`gpu-picture.ts` says why). It is drawn with raw GL calls on
   `renderer.getContext()`: three's state is reset (`renderer.resetState()`)
   before the target is bound with `setRenderTarget`, the target cleared to
   transparent black (depth 1, stencil 0), the picture drawn, and three's state
   reset again before whatever three was drawing into is bound back, since the
   picture leaves its own programs, arrays, textures and blend behind. It is
   drawn unfaded, premultiplied light over transparent black, and with no
   satellites — the headset draws those in the room. Its programs are compiled
   once for each context (`createGpuPicture`) and kept there, since `hologram/gpu`
   has no call that deletes them and the preview makes a new hologram for every
   still. The target is read bottom row first, as every framebuffer is, which is
   the right way up for the quad's own coordinates, so nothing is flipped.
4. **The halo union** (`halo-union.ts`), once a frame, before either eye: every lit
   fragment's halo as a capsule, MAX-blended into a 1024×512 byte target (R/G/B =
   dim/mid/bright coverage; the pinned fragments in the left half, the inner
   layer's in the right, as the phone paints them as separate paths). Stacked one
   by one, the halos were a flat orange coin; the phone strokes each tier's halos
   as one path, so they are a union.
5. **Per eye, the view-plane quad** (`view-plane-quad.ts`): the picture's target
   Screened with the halos' light, facing the centre eye, and faded with the rest
   of him by his arrival (`arrivalOf`) through the blend. It is the whole square,
   corners and all: the halos are where the centre eye sees each fragment, so
   perspective carries them past the 1.86R the phone's drawing stays inside
   (1.92R at 1.6 m while he talks, the corners at 0.4 m), and a quad cut to a
   fixed circle would clip them.
6. **Per eye, the body's strokes** (`body-strokes.ts`): one draw of view-facing
   glyph quads (dash, L, bracket, T, Z, ring, cell as distance fields,
   antialiased, never under 1.2 px) where each fragment really is, with the
   drawing's tier paints and sparkle.

The halo union and the strokes draw one shared geometry (`row-geometry.ts`, over
`hologram/gpu`'s `buildRowVertices`): a plain indexed list of every row's quad,
four vertices and two triangles a row, each vertex carrying its whole row. It
used to be 10,168 instances of a four-vertex quad, which is what Arm's and
Qualcomm's guidance warns against (an instance that small leaves most of each
vertex wave idle); on SwiftShader
the plain list made the halo union about four times as fast and each eye's
strokes about three, and it draws the same triangles in the same order, so the
preview's stills came out the same to the byte. The price is memory: each row is
held four times, 3 MB rather than 0.7.

Where each fragment is comes from `hologram/gpu`'s `fragment-3d.ts`: the phone's
per-fragment helpers from `hologram`, with the body turning about the vertical in
its own frame (its front faces where the user stood when he arrived) and
everything the phone does on screen — the wander, the vortex, the lattice, the
inner layer's turn, a glyph's direction — done in the plane through his centre
that faces the centre eye. Depth is kept: the vortex scales it, the lattice snaps
it into layers where the centre eye sees them line up, the thinking plane is
level with the floor. Its `fragment-glsl.ts` is that file, line for line, in
GLSL; each draw evaluates it in its vertex shader (three 0.186 has no transform
feedback, and a float state pass needs an extension a Quest may not have). The
unit tests hold `fragment-3d.ts` to the phone; `hologram-port.spec.ts` holds the
GLSL to `fragment-3d.ts`; and `hologram-gpu-body.spec.ts` holds the raw renderer
the phone and the watch draw the body with (`drawGpuBody`) to these passes, byte
for byte: the preview draws a moment with three.js, his picture blacked
out, then with `drawGpuBody` on a context of its own from the matrices and
uniforms three drew the strokes with (`src/preview/gpu-body-check.ts`), near and
far, from the front, the side, above and below.

The renderer takes four samples a pixel (`xr/xr-stage.ts`), for the room's plain
triangles; fragments are still shaded once a pixel, so none of these passes looks
any different for it, and the picture and the halo union render into targets of
their own that are never multisampled.

Blending (`layer-blending.ts`): Screen in colour and alpha, raw encoded sRGB — no
three.js colour management anywhere between the picture's bytes and the layer — and
alpha = ALPHA_FROM_LIGHT (0.85) × max(rgb). Why that alpha: passthrough is not
black, and what the page writes as alpha is how much of the room it hides; 0 would
be pure added light, which washes out in a bright room, and max(rgb) is Screen
against the room. It is to be tuned on a headset. Every part is drawn unfaded and
the fade is the blend's constant colour, so arriving, leaving and the close-range
guard fade him as one layer, exactly as the phone's saveLayer does. He fades out
when the head comes within 2.5R, and is gone inside 1.5R (`head.ts`). R is 0.22 m at rest
(`dimensions.ts`); placement may squeeze him to 0.13 m.

Density is 1, with a backstop (`density-backstop.ts`) that halves it when frames
drop: three in thirty more than three quarters again longer than a frame on time,
beside a window with at least two — a lone bad window is a hitch, and the pair is
what a GPU just behind its budget makes, dropping one frame in twelve on a steady
beat. A frame on time is the display's own period, from `XRSession.frameRate` (the
XR stage hands it on with every frame), since a fall from 90 Hz to a clean 45 makes
every frame of a window as long as every other, and a window judged against its
own fastest frame sees nothing late; without the rate it is a quarter of the way up
the shortest intervals seen since the last settle. A film (`?film`) has no backstop:
its faked clock is not the display's. It
used to halve on one window and for good, which every summon's hitches could set
off: nothing compiles his shaders before his first frame, and the display
switches from 72 Hz to 90 as placement, the greeting and the call all start. So the second after `arrive()`, a
new display rate, a change of visibility, and every blurred frame, is not judged at
all (`settle`, called by the room). And the share comes back: after ten seconds
without a drop it doubles, on trial for as long as it was waited for; frames
dropping during the trial halve it again and double the next wait, up to 160 s, so
a headset that cannot hold the count pays one hitch per probe — 10, 20, 40 and 80 s
apart in each room, then every 160 s — rather than a climb-lag-shed cycle, and one
that was busy for a moment gets the particles back a doubling at a time. Never
below an eighth.

Known deviations from the phone: strokes of one tier that cross add up rather than
forming a union, so the arrival's first half-second and the listening knots are a
little hotter; everything the picture draws is flat in the view plane.

**The picture is held to its own goldens.** `tests/e2e/hologram-picture.spec.ts`
draws fifteen moments with it through `picture-target.ts` (the preview's
`checkPicture`) and compares them with frames it drew itself when he was redrawn
after the Vision Quest footage (`tests/e2e/fixtures/picture/`, RGB over black,
drawn by `.scripts/render-picture-goldens.ts`; see "The browser tests"): a mean
of at most 0.4 levels a channel, a 99th percentile of at most 10, at most 0.8% of
pixels a channel more than 16 apart, and the mean luma within 0.1. Drawn again on
the machine that drew them, they match to the byte. The behaviour that was
`hologram`'s pixel tests under CanvasKit — it is golden, its core ring rolls and
its cage turns with his body, it answers speech with activity, spirals in without
a flash, leaves nothing behind, stays in its square, and draws each satellite
where its orbit says — is `tests/e2e/hologram-picture-behaviour.spec.ts`,
measured on the picture as a view shows it: faded as one layer by `arrivalOf`.
