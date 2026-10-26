---
paths:
  - "vr/**"
---

# Commands

> Part of [VR](vr.md). Paths in it are relative to `vr/` unless they say otherwise.

```bash
timeout 60  bunx turbo initialize --filter=vr   # the wasm into public/vendor/ (the build runs it too)
timeout 300 bunx turbo build --filter=vr        # initialize, lint, typecheck, then vite build → dist/vr
timeout 300 bunx turbo test --filter=vr         # the offline unit tests
timeout 1200 bunx turbo e2e --filter=vr         # the browser tests, against a fresh build
timeout 60  bunx turbo lint --filter=vr
bunx turbo serve --filter=vr                    # Vite's dev server on the LAN (persistent: run it in the background)
timeout 3600 bun vr/.scripts/render-demo.ts     # the demo video, after a build (see "The demo video")
```

`serve` does not run `initialize`; run that once first, or onnxruntime-web's
wasm is missing and the page never gets ready.
