---
paths:
  - "vr/**"
---

# The demo video

> Part of [VR](vr.md). Paths in it are relative to `vr/` unless they say otherwise.

`.scripts/render-demo.ts` films the app in the browser tests' emulated Quest 3 and living room and
encodes a WebM (VP9 and Opus):

    timeout 300  bunx turbo build --filter=vr
    timeout 3600 bun vr/.scripts/render-demo.ts --out vr-demo.webm

36 s at 1280x720 and 30 fps takes about a quarter of an hour. `--seconds N` stretches or squeezes
the whole shot (`--seconds 8` is a five-minute draft with every beat); `--size`, `--fps` and `--fov`
(vertical, 66° by default — IWER's 90° leaves him a speck) set the picture; `--frames dir` and
`--keep-frames` keep the PNGs, which are otherwise deleted after the encode; `--readme` also writes the
README's copies beside the WebM — an animated WebP (quality 90, 20 fps, 1280 wide — every frame at 95 put the furnished room past GitHub's 100 MB a file) and a 640-wide
15 fps GIF behind it — because GitHub plays no video from a repository, and the README links the WebM for
the sound. The README's copies are `docs/jarvis-in-a-room.{webm,webp,gif}`. It needs an ffmpeg with
libvpx-vp9 and libopus — FFMPEG_PATH, else the one on the PATH; Playwright's own is VP8-only.
CHROMIUM_EXECUTABLE_PATH works as it does for the browser tests.

**The shot** (`demo-shot.ts`, pure, pinned by `demo-shot.spec.ts`): the real room, entered with a key,
waiting with its hint, the head glancing so the hint is seen trailing the gaze; a cut, from the same
pose, to sample mode — the real room cannot summon him without ElevenLabs — its drawer of samples put
away with B in frames nobody sees, where he is placed 1.6 m
ahead and arrives; a glance about 29° to the right and back while he greets, so he is on the left of
the picture and heard from the left; a walk to arm's length (0.8 m, well outside his 2.5R fade), one
full turn round him there while selects on him walk listening, thinking, idle and speaking, and a
walk back to 1.9 m. The head moves in distance and bearing around his centre, each eased on
overlapping windows so the walk curves rather than stops, with a bob that follows the steps taken,
and looks at his centre but for that glance.

**The page is opened with `?film`,** which leaves sample mode's frame-rate readout out
(`app-state.ts`: `showsReadout`, from the `entered` event). Shot on the faked clock below, the readout
would only ever say "30 fps · build 0.0 ms" under him. Everywhere else sample mode keeps its readout.

**Smooth although SwiftShader is not.** `page.clock` fakes Date, performance and the timers; once the
hint is up the clock is paused and `requestAnimationFrame` is replaced by a queue the script empties.
Each video frame advances the clock by exactly one frame and runs exactly one animation frame — one
XR frame, which IWER stamps with the faked `performance.now()` — so the app, his frame clock and
sample mode all see 1/fps between frames however long the frame took to draw. Playwright's own fake
animation frames run on a 16 ms grid, two or three per video frame, which is why they are replaced.
Placement answers from its worker on real time, and the script waits for it between frames, so he
arrives on the same frame in every render.

**The soundtrack** (`demo-encode.ts` for where, `demo-soundtrack.ts` for how it sounds, both pinned
by their specs): sample mode's speaking is the greeting's measurement repeated, so `assets/greeting.mp3`
is laid under every stretch in which he speaks, on the same 3.14 s beat, cut where a select moves him
on (with an 8 ms fade, so the cut does not click). No repeat starts in the fade out. It is heard from
where he stands, as the app plays it: ffmpeg decodes the recording to mono floats at 48 kHz, and every
5 ms of the film the camera path's head pose gives where he is relative to the head — the gains
between are interpolated. Loudness is the app's own distance model (Web Audio's `inverse`, reference
1 m, rolloff 0.5, from `spatial-voice.ts`: full within a metre, 1/1.3 at 1.6 m); direction is an
equal-power pan by the sine of his angle off straight ahead, 0.6 wide (about 4 dB between the ears
30° off), rather than an HRTF, which sounds like a fault on speakers. Straight ahead each ear gets
exactly the distance gain, so while the head looks at him the film sounds as the app would, and only
the glance leans him left. The recording, which peaks at −16 dBFS, is raised to peak at −3 dBFS
within a metre. The two channels are written as a float WAV beside the frames and encoded as Opus.

**What it leans on:** the page's buttons, IWER's device and controller, `window.__jarvis` (phase,
scene, the hint panel, where he was placed and his radius) and the e2e harness. If a later IWER
captured `requestAnimationFrame` once at install instead of looking it up each frame, the queue
would have to be installed before the page loads.
