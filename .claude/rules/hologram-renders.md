---
paths:
  - "hologram/.scripts/render-*.ts"
  - "hologram/.scripts/simulated-performance.ts"
  - "docs/jarvis-on-a-*"
  - "docs/jarvis.png"
---

# Rendering Jarvis for the README and previews

Every clip or still of the hologram that is rendered offline — the README's phone and watch clips
(`render-showcase.ts`), the cover, the Play assets, and any preview a change is judged by
(`render-preview.ts`) — has to show the best Jarvis the depicted device can actually draw.

## All of him, on the GPU, in headless Chromium

He is drawn only on the GPU, so the scripts draw him — body and all — through `hologram/gpu` in
headless Chromium on SwiftShader, as a phone and a watch do: `createGpuBody` and `createGpuPicture`
once, `drawGpuFrame` each frame, straight on, at density 1, faded by `arrivalOf` and laid over the
background as the device's view lays him (straight over black or nothing, Screened onto anything
else). Each script keeps the clock, the simulated voice (`simulated-performance.ts`), the files and
ffmpeg in Bun, and its drawing half is a page entry, `render-*-page.ts`, which `render-page.ts`
bundles with `Bun.build` and runs in the browser; what is round him — the devices, the sheet, the
labels, the wordmarks — is a 2D canvas in that page (`render-jarvis-page.ts` holds what they share).
There is no Skia or CanvasKit in them and no CPU path to fall back on: a browser without WebGL 2 is
an error. `CHROMIUM_EXECUTABLE_PATH` picks the browser, as for the browser tests, on a machine whose
Chromium is not the build the pinned Playwright expects.

**The committed clips, stills and icons may be regenerated from them**, and the ones in the
repository predate this, so they are not yet what the scripts draw. Regenerating them is a change of
its own, made deliberately and looked at before it is committed. Expect it to be slow: SwiftShader
takes a few hundred milliseconds a frame at these sizes.

## Particle count

**ALWAYS render at the most particles the depicted device can hold** — `PARTICLE_COUNT`, exported
from `hologram`, which the phone and the watch share. **NEVER** a fixed
number chosen in the script.

On a device the density loop draws whatever share of that ceiling it can afford; offline nothing has
to hold a frame rate, so a render draws all of it. The README clips were once rendered at a fixed
1300 on both devices, a fraction of what either draws, and showed a sparser Jarvis than the apps.

❌ `createHologramScene(1337, 1300)`
✅ `createHologramScene(1337, PARTICLE_COUNT)`, for the phone and the watch alike

A device whose ceiling lives in its app belongs in `hologram` instead, so the render can import it.

## Quality and frame rate

**ALWAYS encode the animations at 95% quality and 40 frames a second** — every copy: the WebP the
README shows, the GIF behind it, and the WebM archive. Render at twice the width the README shows
them at. **Bandwidth is not a concern**: never trade quality or frames for file size.
