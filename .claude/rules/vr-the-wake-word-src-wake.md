---
paths:
  - "vr/**"
---

# The wake word (`src/wake/`)

> Part of [VR](vr.md). Paths in it are relative to `vr/` unless they say otherwise.

"Hey Jarvis" is openWakeWord's `hey_jarvis_v0.1`, with its melspectrogram and
embedding models, on onnxruntime-web's WebAssembly backend, in a module worker.
The microphone reaches it through an AudioWorklet in a 16 kHz AudioContext of its
own. The worklet packs 1280-sample int16 frames (80 ms; ten render quanta at
16 kHz) and posts them to the worker over a MessagePort of their own, so audio
never waits on the main thread, which is drawing the room.

    microphone ─► MediaStreamSource ─► pcm-frames.worklet ─► gain 0 ─► destination
                                              │ MessagePort (Int16Array × 1280)
                                              ▼
                       wake.worker ─► serial queue ─► pipeline (mel → embedding → classifier) ─► gate
                                              │ stats ×4/s, wake
                                              ▼
                       wake-engine (watchdog, 500 ms) ─► health, onWake

```
types.ts              the public types (WakeEngine, WakeHealth, WakeDiagnostics, profiles)
index.ts              createWakeEngine with the real worker, AudioContext and getUserMedia
wake-pipeline.ts      openWakeWord's streaming pipeline, graphs behind an interface (pure)
detection-gate.ts     threshold 0.5, armed, 2 s refractory counted in chunks (pure)
serial-queue.ts       one chunk at a time; drops the oldest beyond 3 waiting, never a reset (pure)
pcm-frames.ts         float → int16 frames and the level (pure); pcm-frames.worklet.ts runs it
resampler.ts          box filter + interpolation, for a context that ignored 16 kHz (pure)
wake-health.ts        one observation → state, words for the status line, recover or not (pure)
download.ts           parallel downloads with one progress fraction weighted by size
wake-assets.ts        vendor/ and models/ under the page, and each file's size
worker-protocol.ts    the messages, read with guards
wake-worker-core.ts   the worker's logic; wake.worker.ts wires it to onnxruntime-web
ort-models.ts         the three sessions (created one after another), outputs copied
audio-graph.ts        the 16 kHz context and the worklet
microphone.ts         openWakeMicrophone (8 s timeout, readable errors), microphonePermission
wake-engine.ts        worker + graph + microphone + watchdog + recovery, all injected
harness/              a bare page for the browser test (never part of the site)
fixtures/             spoken clips (espeak-ng, made during the research) and a WAV reader
```

**The pipeline is exact, not approximate.** Two of the four JavaScript ports the
research read got the bookkeeping wrong; one scores 0.003 where the Python package
scores 0.995. So `wake-pipeline.ts` follows `openwakeword/utils.py` and `model.py`
step for step: int16 scale, never ±1; each chunk sent with the previous 480
samples (8 mel frames per chunk, not 5); `x / 10 + 2`, and a mel buffer that
starts as ones; one embedding per chunk from the last 76 frames; the last 16
embeddings, starting as embeddings of 4 s of uniform noise in [-1000, 1000); the
first 5 predictions after a reset forced to 0. `real-models.spec.ts` runs the real
models under `bun test` on the clips and expects the Python package's peaks (0.99,
on chunks 41 and 42). openWakeWord's `patience` is not ported: it never fires
upstream. A 2 s refractory period replaces it, and arming restarts it along with a
full reset.

**onnxruntime-web.**
- **Entry:** `onnxruntime-web/wasm`, never the main entry, which brings the 28 MB
  WebGPU build. `numThreads = 1`, because GitHub Pages cannot make the page
  cross-origin isolated.
- **The Vite condition:** `vite.config.ts` resolves it with the
  `onnxruntime-web-use-extern-wasm` condition, so the 14 MB wasm is never bundled.
  The worker downloads it itself from `vendor/` (for the progress bar), hands it
  over as `env.wasm.wasmBinary`, and points `env.wasm.wasmPaths` at `vendor/` for
  the glue. Setting `resolve.conditions` replaces Vite's defaults, which is why
  `defaultClientConditions` is spread after it.
- **Under Bun:** the default entry carries its glue and finds its wasm in
  `node_modules`; giving it paths there breaks it.
- **Recovery:** a failed initialisation never recovers in the same worker, so any
  model failure terminates the worker and a recovery starts a new one.

**Health and recovery.**
- **Listening means scored.** The engine is `listening` only after the models
  scored a chunk of live audio from the current stream and chunks keep flowing
  (≥ 10 per second). Anything else carries a `problem` in words for the status
  line. While disarmed, chunks are counted but not scored, to spare the headset
  during a call, so the health stays as it was.
- **What the watchdog checks.** Every 500 ms: the track ending or muting, the
  AudioContext leaving `running`, no chunk for 1 s, no worker report for 3 s, and
  10 s of exact digital zeros. A tick that comes more than half an interval late
  judges nothing: the page was held up, and the worker's reports from meanwhile
  are still queued behind the tick — judged then, the page's own stall would read
  as the microphone's.
- **How it recovers,** in this order, with a backoff of 5 s doubling to 60 s:
  `permissions.query`, resuming the context (1.5 s), reopening the microphone. It
  never shows a permission prompt and never suspends the context. When a gesture
  is needed, `health.needsGesture` is set and the room calls `rebuild()` inside the
  next select. A muted track is waited out: its `unmute` event recovers it, and
  another capture would be muted the same way.
- **Streams.** The engine never stops a stream it was given; it stops only the
  ones it reopened itself. `stop()` before the app stops its microphone.

**The profile** is `processed` (echo cancellation, noise suppression and gain
control on) by default: it is what the ElevenLabs SDK asks for, so the wake stream
and the call's capture are the same kind, and Android never switches its audio
mode mid-greeting, which is what made the phone's greeting clipped and thin.
`?microphone=raw` turns all three off.
