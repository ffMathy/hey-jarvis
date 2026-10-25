---
paths:
  - "vr/**"
---

# The wake-word models, and their licence

> Part of [VR](vr.md). Paths in it are relative to `vr/` unless they say otherwise.

`public/models/` holds openWakeWord's `melspectrogram.onnx`, `embedding_model.onnx`
and `hey_jarvis_v0.1.onnx`, **byte for byte** its v0.5.1 release assets, committed
so the build needs no network and so the site never depends on a third-party
download (GitHub's release URLs send no CORS headers, so a browser could not fetch
them anyway). `src/wake/models.spec.ts` pins their SHA-256; a different file fails
the suite. `WAKE_FILES.runtime.bytes` must follow any onnxruntime-web upgrade; a
spec fails until it is updated.

**They are CC BY-NC-SA 4.0**, by David Scripka — not this repository's licence.
Attribution is in `public/models/LICENCE.txt` (published with the site) and in the
page's footer. Non-commercial: anyone using this app commercially has to replace
the models first.
