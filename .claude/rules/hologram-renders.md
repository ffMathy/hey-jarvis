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

## Particle count

**ALWAYS render at the most particles the depicted device can hold** — `PARTICLE_COUNT` for the
phone, `WATCH_PARTICLE_COUNT` for the watch, both exported from `hologram`. **NEVER** a fixed
number chosen in the script.

On a device the density loop draws whatever share of that ceiling it can afford; offline nothing has
to hold a frame rate, so a render draws all of it. The README clips were once rendered at a fixed
1300 on both devices, a fraction of what either draws, and showed a sparser Jarvis than the apps.

❌ `createHologramScene(1337, 1300)`
✅ `createHologramScene(1337, PARTICLE_COUNT)` for the phone, `createHologramScene(1337, WATCH_PARTICLE_COUNT)` for the watch

A device whose ceiling lives in its app belongs in `hologram` instead, so the render can import it.

## Quality and frame rate

**ALWAYS encode the animations at 95% quality and 40 frames a second** — every copy: the WebP the
README shows, the GIF behind it, and the WebM archive. Render at twice the width the README shows
them at. **Bandwidth is not a concern**: never trade quality or frames for file size.
