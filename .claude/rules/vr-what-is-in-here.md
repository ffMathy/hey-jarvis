---
paths:
  - "vr/**"
---

# What is in here

> Part of [VR](vr.md). Paths in it are relative to `vr/` unless they say otherwise.

```
index.html                 the 2D page: settings, the walk to the room, the models' attribution
preview.html               the desktop preview (src/preview/)
src/main.ts                chooses the parts, wires the page to the room, owns the Enter tap
src/debug-hook.ts          window.__jarvis, what the browser tests read (see below)
src/test-seams.ts          ?deadline=never and ?errors=held, the clocks the browser tests hold (see below)
src/page/                  the 2D page: settings, preparations, the microphone step
src/app/                   the room's state machine, its runtime, the ports, sample mode, placement's adapter,
                           the entities controller
src/xr/                    the XR stage and frame loop, input (selects, buttons, hands and controllers per frame),
                           depth probes, anchors, frame rate, keyboard, the ?origin seam
src/ui3d/                  text in the room: the hint, status line, guide, error panel, captions, debug HUD; the
                           drawer, tokens, names, pointing reticle and wrist button
src/entities/              what Jarvis works on, placed in the room: registry, room anchors, corona lifetime,
                           pointing, hand poses, grabbing, what the hands and controllers mean to them
src/satellites/            seeing him work: where each satellite is round him (the glyph atlas and the draw
                           are in src/hologram3d/)
src/wake/                  "Hey Jarvis": the microphone, the worklet, the onnxruntime-web worker, the watchdog
src/room/                  where he stands: room snapshots, the occupancy grid, placement and its worker
src/conversation/          hologram's session with the headset's parts: the greeting, his track, his voice from where he stands, orphaned audio
src/hologram3d/            Jarvis in 3D: the frame clock, the body's strokes and the halo union as three.js
                           draws hologram/gpu's passes, CanvasKit
src/preview/               the preview page
public/models/             the openWakeWord models and their LICENCE.txt (committed)
public/vendor/             canvaskit.wasm and onnxruntime-web's wasm (gitignored; see initialize)
tests/e2e/                 Playwright: the emulated headset and room, and the specs
.scripts/initialize.sh     copies the wasm out of node_modules into public/vendor/
.scripts/build.sh          vite build into ../dist/vr
.scripts/test.sh           bun test over every *.spec.ts outside tests/e2e
.scripts/serve-dist.ts     serves the build under /hey-jarvis/vr/ for the browser tests
.scripts/render-demo.ts    renders the demo video (demo-shot.ts: the shot and camera; demo-soundtrack.ts: his voice
                           from where he stands; demo-encode.ts: where the greeting goes, and ffmpeg)
```
