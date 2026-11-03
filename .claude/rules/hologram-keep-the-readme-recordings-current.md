---
paths:
  - "hologram/src/**"
  - "hologram/.scripts/**"
  - "vr/src/hologram3d/**"
  - "vr/tests/e2e/fixtures/picture/**"
---

# Keep the README's recordings current

> Part of [Hologram](hologram.md).

**ALWAYS re-record the README's videos in the same change whenever the hologram looks or moves
differently** ("Remember to always update the video recordings of the readme whenever the hologram
changes"). That is any change to how he is drawn or animated, on any device: the drawing, the GPU
passes, the frame clock, the voice tracking behind it, the headset's `hologram3d`, or redrawn
picture goldens.

What to record again, all from the repository root:

| Files | How |
| --- | --- |
| `docs/jarvis-on-a-phone.{webm,webp,gif}`, `docs/jarvis-on-a-watch.{webm,webp,gif}`, `docs/jarvis.png` | `timeout 3000 bun hologram/.scripts/render-showcase.ts` (see [Rendering Jarvis](hologram-renders.md)) |
| `docs/jarvis-in-a-room.{webm,webp,gif}` | `timeout 600 bunx turbo build --filter=vr`, then `timeout 5400 bun vr/.scripts/render-demo.ts --out docs/jarvis-in-a-room.webm --readme` (see [The demo video](vr-the-demo-video.md)) |

Both need `CHROMIUM_EXECUTABLE_PATH` set as for the browser tests, and take a long time on
SwiftShader, so start them in the background as soon as the look is settled. Look at the new
recordings before committing them, and send them to the user ([Show Progress in
Pictures](show-progress-in-pictures.md)).

❌ A pull request that changes how he speaks, while the README still shows the old Jarvis.
✅ The same pull request with the clips recorded from its own build.

Why: the README is the first picture of him anyone sees, and a clip of an older Jarvis shows
something no device draws any more.

A change that cannot alter a single frame (a refactor proven byte-identical by the goldens, a test,
a comment) needs no new recording.
