# Horizon

Jarvis in your room, on a Meta Quest. A WebXR page that opens an `immersive-ar`
(passthrough) session and waits: say "Hey Jarvis" and he appears where the room
has space in front of you, greets you, and holds the full ElevenLabs
conversation — the same hologram, the same agent and the same rules for a
conversation as the phone and the watch, from the same `hologram` package. When
he has gone, the wake word is listened for again.

> **Note:** See the root [AGENTS.md](../AGENTS.md) for shared conventions (Turborepo commands, commit standards, 1Password, etc.)

## Using it on a Quest

Open **https://ffmathy.github.io/hey-jarvis/horizon/** in Quest Browser. Quest 3
and 3S are the target; Quest 2 and Pro work, without the room scan.

1. **The ElevenLabs agent.** The page asks for an API key and an agent ID once,
   and checks them by minting a token before keeping them. They are the phone's
   settings, stored the phone's way on the same origin, so a browser that has
   the phone's web build set up already has them.
2. **Getting ready.** The wake-word models and CanvasKit load with a progress
   bar while you read the page.
3. **Allow the microphone** — the first tap. Skipped when the browser says the
   permission is already granted.
4. **Enter your room** — the second tap.
5. **"Hey Jarvis"**, or a pinch or a trigger pull (an XR `select`). He is placed,
   arrives, says the firmware's recorded "Hello sir, how can I help?" while the
   session is fetched, and then the conversation is live.

While you wait, nothing is drawn but a hint — "Say “Hey Jarvis”", shown only
once the wake engine has really scored live audio — and, whenever it is not
listening, a status line saying why and what to do about it.

- **Sending him away:** a select held for 0.8 s or longer, or B/Y, hangs up; the
  agent can also end the call itself. A short select during a call does nothing:
  hands pinch by accident while people talk. A wake word or a select while he is
  leaving cancels the fade and summons him again.
- **Typing:** while the call is live, a keyboard button under him opens the
  headset's system keyboard; a line is sent on a newline or when the keyboard is
  put away, and his reply is written under him.
- **When something fails** — a rejected key, no network, a call that drops — the
  problem hangs at his spot for as long as it takes to read, then he leaves and
  the wake word is armed again. The 2D page shows the last problem once the room
  is closed.
- **Try him in your room** is sample mode: no key and no microphone. Select him
  to walk his moods (speaking, listening, thinking, idle); select anywhere else to
  leave.
- **No headset?** https://ffmathy.github.io/hey-jarvis/horizon/preview.html shows
  him in 3D on a desktop, phase by phase (see "The preview page" below).
- **His voice from where he stands:** on a headset with an echo canceller of its
  own, his voice comes from his spot in the room, and it moves with your head;
  otherwise it comes from the headset, as before. A switch on the 2D page turns it
  off (see "His voice from where he stands" below).
- **URL flags:** `?debug` shows a diagnostics HUD in the room; `?flat` draws him
  as the phone's flat picture instead of in 3D; `?microphone=raw` listens for
  the wake word without echo cancellation, noise suppression or gain control, to
  try on a headset whether it hears better that way; `?voice=spatial` plays his
  voice from where he stands even when the microphone says the headset has no
  echo canceller of its own, to hear what that does; `?film` is for recordings,
  and leaves sample mode's frame-rate readout out (see "The demo video").

## What is in here

```
index.html                 the 2D page: settings, the walk to the room, the models' attribution
preview.html               the desktop preview (src/preview/)
src/main.ts                chooses the parts, wires the page to the room, owns the Enter tap
src/debug-hook.ts          window.__jarvis, what the browser tests read (see below)
src/page/                  the 2D page: settings, preparations, the microphone step
src/app/                   the room's state machine, its runtime, the ports, sample mode, placement's adapter
src/xr/                    the XR stage and frame loop, input, depth probes, anchors, frame rate, keyboard
src/ui3d/                  text in the room: the hint, status line, error panel, captions, debug HUD
src/wake/                  "Hey Jarvis": the microphone, the worklet, the onnxruntime-web worker, the watchdog
src/room/                  where he stands: room snapshots, the occupancy grid, placement and its worker
src/conversation/          hologram's session with the headset's parts: the greeting, his track, his voice from where he stands, orphaned audio
src/hologram3d/            Jarvis in 3D: the frame clock, the body's strokes, the halo union, CanvasKit
src/preview/               the preview page
public/models/             the openWakeWord models and their LICENCE.txt (committed)
public/vendor/             canvaskit.wasm and onnxruntime-web's wasm (gitignored; see initialize)
tests/e2e/                 Playwright: the emulated headset and room, and the specs
.scripts/initialize.sh     copies the wasm out of node_modules into public/vendor/
.scripts/build.sh          vite build into ../dist/horizon
.scripts/test.sh           bun test over every *.spec.ts outside tests/e2e
.scripts/serve-dist.ts     serves the build under /hey-jarvis/horizon/ for the browser tests
.scripts/render-demo.ts    renders the demo video (demo-shot.ts: the shot and camera; demo-soundtrack.ts: his voice
                           from where he stands; demo-encode.ts: where the greeting goes, and ffmpeg)
```

## Commands

```bash
timeout 60  bunx turbo initialize --filter=horizon   # the wasm into public/vendor/ (the build runs it too)
timeout 300 bunx turbo build --filter=horizon        # initialize, lint, typecheck, then vite build → dist/horizon
timeout 300 bunx turbo test --filter=horizon         # the offline unit tests
timeout 1200 bunx turbo e2e --filter=horizon         # the browser tests, against a fresh build
timeout 60  bunx turbo lint --filter=horizon
bunx turbo serve --filter=horizon                    # Vite's dev server on the LAN (persistent: run it in the background)
timeout 3600 bun horizon/.scripts/render-demo.ts     # the demo video, after a build (see "The demo video")
```

`serve` does not run `initialize`; run that once first, or CanvasKit's wasm is
missing and the room opens empty.

## How the parts fit

`main.ts` is the one place that chooses them. The room (`app/room-runtime.ts`)
knows each other module only through `app/ports.ts`, which names the few calls it
makes of each — the wake engine, the session and the hologram fit their ports as
they are; placement has an adapter (`app/room-placement.ts`), because the room
model answers from a worker and has to be fed snapshots only an XR frame can take.

**What loads when.** The page itself, the wake engine and the greeting's player
are in the first chunk, because the page needs them from its first frame: the
models load and warm up while the user reads, and the Enter tap has to reach the
engine and the player before it awaits anything. The room — three, the hologram,
the placement client — and the ElevenLabs SDK with LiveKit (about 600 kB of their
own, in a chunk of their own) are loaded apart, but started at once rather than
on the tap, so they have usually arrived by the time someone finds the button.

**The Enter tap**, in this order and before anything is awaited, because each of
these is only allowed while the tap's activation lasts:

1. the app's AudioContext is created or resumed (his voice is analysed on it);
2. the greeting's player is primed — an element that has played inside a gesture
   may play again outside one, and the greeting starts long after the tap;
3. the wake engine is started, creating its 16 kHz AudioContext — on the stream
   the microphone step opened and kept, when there was one; when the permission
   was already granted there was no such step, a stream is opened now, and the
   engine starts once it arrives (Chromium allows that after any tap on the page,
   and the watchdog would ask for a select otherwise);
4. the immersive session is requested.

**A summon**, from the wake word or a select: the next XR frame reads the room and
the depth probes and asks for a spot; he is drawn there at once and anchored in
the same frame; the session starts the greeting and the token request together,
and dials once the greeting is over. **The wake word is armed again only once his
voice has been quiet for two seconds** (`session.quietFor(2)`, which the room
reports to the state machine as `voice-quiet`): it listens through microphones a
few centimetres from the speakers his voice comes out of.

**When the session ends**, the room stops the wake engine *before* it stops the
microphone's tracks: the engine's watchdog would see the tracks end and open the
microphone again.

## The page, the room and its state machine (`src/page/`, `src/app/`, `src/xr/`, `src/ui3d/`)

**The page (`src/page/`) walks you to the room.** `index.html` is plain DOM in the
phone's colours (`ui3d/ui-colours.ts` names the same values), large enough to read
on Quest Browser's panel and to point at with a ray. The big button always names
the first step not yet done, so it is both the instructions and the way through
them: the key, getting ready, **Allow the microphone**, **Enter your room**.
`prerequisites.ts` decides this and `prerequisites.spec.ts` pins it.

- **The microphone is its own tap,** because Quest Browser cannot show its
  permission prompt inside an immersive session. The step opens the wake word's
  own stream (`page/microphone.ts`, with `src/wake/`'s permission check and
  microphone) and keeps it for the Enter tap. A refused microphone gets
  instructions for allowing it again.
- **Getting ready** runs the preparations `main.ts` hands over — the wake engine's
  `prepare` and CanvasKit — with one progress bar weighted by what each fetches.
  A failure offers to try again, retrying only what failed.
- **Settings are the phone's,** under hologram's `ELEVENLABS_SETTINGS_STORAGE_KEY`,
  in `localStorage`. **Check and save** mints one token as `jarvis-horizon` before
  keeping anything, so a mistyped key shows next to the field, not as an error
  panel in the room.
- **"His voice from where he stands"** is the headset's one setting of its own
  (`page/voice-setting.ts`, under `jarvis.horizon.voice-from-where-he-stands`):
  on by default, and read again on every Enter. Off keeps his voice on the
  headset whatever the headset could do.

**Everything in the room goes through one pure reducer (`app/app-state.ts`).**
Every event goes through `reduceApp(model, event, now)`: the wake word, selects
(already classed as tap or hold, and as on him, on the keyboard button or
elsewhere), B and Y, the conversation's phases and problems, his voice going
quiet, XR visibility, the session ending, the wake engine's health and the
keyboard. What comes out is a new model and a list of effects. Panels, the
hologram's visibility, the frame rate and whether the wake word is armed are
derived from the model and emitted as the difference between the view before and
after. The product rules pinned in `app-state.spec.ts`:

- **Dismissing:** a hold of 0.8 s or longer, or B/Y, hangs up. A tap during a call
  does nothing. A tap while he is leaving summons him again where he stands.
- **Failures:** the problem stays on a panel at his spot for max(6 s, reading
  time) or until a select. Then he leaves and the wake word is re-armed.
- **Re-arming:** only while waiting (or leaving towards waiting), in view, with the
  wake engine's health checked, and once his voice has been quiet for two seconds.
- **Visibility:** blurred keeps the call but ignores the wake word and selects, and
  a minute of it ends the call. Time spent with the system keyboard up does not
  count. Hidden ends the call quietly and disarms; coming back checks the wake
  engine before arming.
- **Session end:** hangs up, stops the microphone and brings the page back.
- **The hint** shows only when the wake engine is really listening, and only until
  the first summon. A status line shows whenever it is not listening.

**`app/room-runtime.ts` is where the parts meet.** It opens the stage, queues
events so each step sees the model the previous one left, and carries out the
effects: it places him in the next XR frame (the head, the gaze or the ray of the
select that summoned him, the depth probes), anchors the spot, drives the
hologram from the conversation or from sample mode (`app/sample-driver.ts`, which
only remembers the mood and takes what it hands the hologram from hologram's
`createSampleDrive`, the code the phone's and the watch's sample hooks wrap), and
arranges the panels: what is about him is world-locked under him; the hint and
status line follow the gaze with a lag. A select also calls the wake engine's
`rebuild` when it needs a gesture to get audio going again, since a select is the
only user activation there is inside the room.

**The XR layer (`src/xr/`).**
- `xr-stage.ts` sets up the renderer (alpha, no antialiasing, premultiplied,
  foveation 0.3). It runs one frame loop whose subscribers get the frame, the
  space, the viewer pose, the centre eye and a time step capped at 0.1 s. It also
  keeps the reference-space reset epoch, the visibility state and the frame rate:
  the lowest while waiting, the highest up to 90 while he is there.
- `xr-input.ts` turns selects into taps and holds, and reads B and Y (`buttons[5]`)
  from the gamepads each frame.
- `depth-probes.ts` is five viewer-space hit-test rays.
- `anchor-keeper.ts` creates an anchor in the placement's frame and deletes the
  previous one.
- `system-keyboard.ts` is a hidden `<textarea>`. Quest Browser shows its keyboard
  inside WebXR when the textarea is focused.

**Text in the room (`src/ui3d/`).** Panels are canvas-drawn text on planes at
1500 px per metre, which is about what a Quest 3 shows at arm's length, each with
a translucent backing so it can be read over any passthrough, drawn after
everything else and never hidden by his glow. There is also a drawn keyboard
button, a head-locked arrow for a spot out of view, and `?debug`'s HUD, whose
lines come from `describeDiagnostics` and are left out for parts with nothing to
report: the scene, XR and page visibility, the AudioContexts, the microphone's
permission and track, the wake engine's health and audio, the SDK's status and
mode, interruptions, half-duplex and the last error, the vad score, where his
voice comes from (its tier, why, what the microphone said about the echo
canceller, and the SDK's elements and their volume), the room's
planes, meshes, labels, triangles and grid, where he was placed, frame rates, his
CPU and CanvasKit time and surface, the granted session features and the WebGL
extensions of interest.

## The wake word (`src/wake/`)

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

## Where he stands (`src/room/`)

When he is summoned, `src/room/` chooses the spot: in front of you, in the same
room, with space around him and nothing between him and your eyes. It works from
whatever the headset shares — Space Setup's planes (every Quest), its furniture
boxes and room scan (Quest 3 and 3S), or nothing at all — and from a few live
depth rays.

```
src/room/index.ts               the module's surface
src/room/types.ts               snapshots, requests and placements: plain data, postable to a worker
src/room/room-snapshot.ts       reads planes and meshes out of an XR frame; counts reference-space resets
src/room/occupancy-grid.ts      10 cm cells, an exact distance transform, Amanatides–Woo line of sight
src/room/scene-geometry.ts      poses planes and meshes, and draws them into the grid
src/room/room-scene.ts          the grid, floors, ceilings, wall outline and table tops, built from a snapshot
src/room/placement.ts           candidates, rules, scores and the relax chain
src/room/room-model.ts          createRoomModel: the same, on the calling thread
src/room/room-model-worker.ts   createRoomModelWorker: the same, from a worker
src/room/room-worker*.ts        the worker, its message protocol, and its time-sliced host
src/room/synthetic-rooms.ts     rooms built by hand, for the specs only
src/room/sem-room.ts            @iwer/sem's captured rooms as snapshots, for the specs only
src/app/room-placement.ts       the room's placement port over the model: when to read the room
```

**Reading the room.** `createRoomTracker(referenceSpace).take(frame)` must be
called inside an XR frame callback. Each call re-reads every pose, but copies a
plane's or a mesh's vertices again only when it really changed, and returns the
previous snapshot itself when nothing did — so `snapshot !== last` says whether to
send it on. `app/room-placement.ts` calls it every 300 ms and in the frame a summon
waits on, gives up on a placement after 5 s (the room then uses its fallback
spot), and keeps the room's description for the HUD. Two things it has to see
through:
- **The emulator marks everything changed on every frame.** IWER sets
  `lastChangedTime` on every plane and mesh each frame. A moved change time is
  checked against the copy — a mesh handed over in the very arrays last copied
  counts as unchanged — before anything is copied.
- **A recentre moves every pose without saying so.** `local-floor` fires `reset`,
  and no `lastChangedTime` changes. `watchResets` counts the resets, and the count
  is the snapshot's `epoch`: a new epoch reuses nothing, the worker makes questions
  wait for the new grid, and a `previous` spot from an older epoch (the adapter
  passes `previousEpoch`) is ignored.

Features the session was not granted read as empty (Chromium throws
`NotSupportedError` otherwise). Plane normals may point either way — the captured
rooms turn floors upside down — so only the normal's axis is used, never its sign.

**The grid.** 10 cm cells around the geometry, capped at 10 m from the session's
origin. Planes are drawn as two sheets 5 cm apart, so a wall at an angle to the
grid leaves no gap for a line of sight; furniture boxes are filled solid; the room
scan's triangles are sampled every 5 cm. An exact Euclidean distance transform
(Felzenszwalb–Huttenlocher, three passes) then gives every cell its distance to
the nearest occupied one. Clearance is read from it, less half a cell, so it errs
towards too little room.

**Choosing.** Candidates fan out ±35° ahead along the floor (ahead of the gaze, or
of the controller ray that summoned him), 0.9–2.6 m away, at
clamp(eyes − 0.15, 1.1, 1.6) m above the floor and a few heights either side. Hard
rules: the clearance the level asks for, inside the room (the floor polygon under
the head, else the ceiling over it, else the walls around it), clear of the user's
body, not behind a surface a depth ray sees, and a clear line of sight from 20 cm
past the eyes. The rest are scored on clearance (up to 1 m), distance from 1.6 m,
angle from ahead, height, and closeness to where he stood last time. When nothing
qualifies, the rules relax in turn:

| Level | Radius | Clearance | Distance | Cone |
| --- | --- | --- | --- | --- |
| `full` | 0.22 m | 0.5 m | 0.9–2.6 m | ±35° |
| `tight` | 0.22 m | 0.35 m | 0.9–2.6 m | ±35° |
| `small` | 0.13 m | 0.3 m | 0.6–2.6 m, and over table and desk tops | ±35° |
| `wide` | full size, then squeezed | as `tight`, then `small` | as above | ±60°, `needsPointer` |
| `fallback` | 0.13 m | — | 1.2 m ahead, pulled in front of anything known | straight ahead |

With nothing known about the room at all it goes straight to `fallback`: a
full-size hologram 1.6 m ahead of someone at a desk facing a wall a metre away
would be inside the wall. A depth probe rejects a spot when its ray passes within
the level's clearance of it and the hit is nearer than the spot; hits under 0.4 m
are ignored.

**Off the main thread.** `createRoomModelWorker` builds each snapshot's grid in the
worker in 8 ms slices, answering `place` meanwhile from the grid it built last. It
waits instead before the first grid and after a recentre. A snapshot that arrives
mid-build waits its turn, so a room that keeps changing still gets built. If the
worker cannot start or fails, placement carries on in the page. Every room entered
gets a model of its own, since the snapshots are in the session's reference space.

**How long it takes.** The captured living room — 17 planes, 8 boxes, a
62,102-triangle scan — builds in about 40 ms warm in Bun (140–240 ms cold in
Chromium, 40–60 ms warm), and a placement takes about 1 ms. `sem-room.spec.ts`
prints the numbers on every run and fails above 250 ms and 5 ms, limits that leave
room for a busy machine.

**Tests.** `placement.spec.ts` covers hand-built rooms: an open living room, a desk
facing a wall, a wardrobe ahead, two rooms joined by a doorway, planes or boxes or
a scan alone, nothing at all, a room divider, depth rays, recentring and
hysteresis. `sem-room.spec.ts` places him in all five of `@iwer/sem`'s captured
rooms, facing eight ways in each. `tests/e2e/room-placement.spec.ts` does it from
the emulated Quest's real XR frames in the browser.

## The conversation (`src/conversation/`)

The session is `hologram`'s `createJarvisSession` — the one the phone and the
watch hold their conversations in too (see "One conversation, three devices" in
`../hologram/AGENTS.md`). `createHeadsetSession` (`headset-session.ts`) hands it
what is the headset's: its name (`jarvis-horizon`), no platform delay before
dialling, the half-duplex fallback, its words for being offline, his track
analysed on the app's `AudioContext` (`agent-room.ts`), the greeting's `<audio>`
element (`greeting-player.ts`) and the orphaned-audio sweep
(`orphaned-audio.ts`). It holds one summoning at a time on the ElevenLabs SDK's
own client (`Conversation.startSession` from `@elevenlabs/client`, passed in as
`startSession`), with no React provider, and keeps that provider's guarantees:

- **One start at a time.** A summon is ignored unless the last one is `idle`,
  `ended` or `failed`, because two WebRTC sessions at once tear each other down.
- **Stale callbacks are dropped.** Every SDK callback is bound to the summoning
  that dialled it, and is ignored once that summoning is closed or replaced.
- **Status and mode come only from `onStatusChange` and `onModeChange`.** The
  provider treats any `onError` as the end of the conversation, which would send
  Jarvis away over a non-fatal server message.

Phases run `idle → greeting → connecting → live → ended`, with `failed` as a
separate terminal state:

- **What fails.** Every way a summoning can go wrong ends in `failed`, with
  `onProblem` called first: the token request, a rejected start, an SDK error
  before the conversation opens, the `GIVE_UP_CONNECTING_AFTER_MS` deadline, and a
  `reason: 'error'` disconnect once open.
- **What every ending does.** It stops the greeting and ends the session. A
  session that connects after the deadline gave up on it is ended the moment its
  start resolves.
- **Why `failed` is separate from `ended`.** In the room, an ending is Jarvis
  leaving, while a failure is a panel that has to outlive him.

**The greeting and the token start together; the session is dialled after the
greeting.** The token request (as `jarvis-horizon`) goes out the moment he is
summoned, alongside the recording, which is hologram's `assets/greeting.mp3`
imported with `?url`.

- **Why wait.** Dialling after the greeting is what the phone does natively. The
  session's microphone opening mid-greeting is what clipped the recording on the
  phone, and it would let the agent hear the greeting before the session could be
  muted. `waitsForGreetingBeforeDialling: false` dials while he is still greeting,
  and mutes from `onConversationCreated` until he has finished.
- **A refused recording.** The session sends no override, so the agent keeps its
  own first message. A recording the browser never answers for is given up on by
  the shared `isGreetingOver` rule.
- **Checking the greeting's end.** The 50 ms timer checks it, and so does every
  read of his voice, so a throttled timer never holds the microphone muted.
- **Unlocking autoplay.** `prime()` on the player, inside the Enter tap.

**Three things can hold the microphone muted, and it opens only when none of them
does:** the greeting; the keyboard (`setTyping`, the phone's text mode); the
half-duplex fallback while he speaks, which only the headset asks for.
`half-duplex.ts` (in `hologram`) turns that fallback on for
the rest of a conversation when an interruption comes within 300 ms of him
starting to speak, or when two interruptions arrive with no transcript of the user
between them — both signs of his own voice coming back through a weak echo
canceller. It gives up barge-in, so it shows on the HUD.

**What the hologram reads from the session**, read again on every frame because
the object changes when its source does:
- `voice` is the greeting's envelope while he greets. Once connected, it is his
  LiveKit track, analysed on the app's `AudioContext` (`agent-room.ts`), with the
  SDK's readers as a fallback. Otherwise it is silence.
- `user` is hologram's `vad_score` keeper, deaf while he speaks or greets, plus
  the SDK's input level.
- `thinking` comes from hologram's `createToolActivity`.

**His voice from where he stands** (`spatial-voice.ts`, with the route in
`voice-route.ts` and what it watches for in `voice-watch.ts`). Three tiers,
safest last:

1. **Spatial.** The greeting and then his track go through one HRTF panner at his
   centre — the room hands over his anchored position every XR frame, after the
   hologram has followed the anchor — and the AudioContext's listener follows the
   centre eye (position, forward and up), small steps glided over 30 ms and a new
   spot jumped to. Distance is `inverse`, full level within a metre, half the
   usual rolloff beyond it, so at 1.6 m he is at about three quarters of the level
   the headset played him at. His track's one `MediaStreamSource` feeds both the
   sphere's analyser and the panner. The SDK's own `<audio>` element keeps playing
   at **volume 0 — never muted, never paused**, and only while his track really is
   going through the panner (`agent-element-volume.ts`): Chromium pulls a remote
   WebRTC track into Web Audio only while an element renders it, applies the
   element's volume after that point, and LiveKit sets `muted = false` again on
   every attach and every microphone acquisition. Every element is found — on the
   page when the volume changes, from LiveKit's `ElementAttached`, and from a
   `MutationObserver` on the body. The greeting's element is taken into Web Audio
   (`createMediaElementSource`, once per page for good) only when he first greets
   from where he stands.
2. **Element.** The SDK's element plays him from the headset, exactly as before.
3. **Half duplex.** The session's fallback (see below), on top of the element.

**Which tier.** Spatial only when the wake word's own microphone track offers
`echoCancellation: 'all'` in its capabilities (`echo-canceller.ts`) — on Android
that means the device has an echo canceller of its own, which subtracts whatever
the device plays, Web Audio included. Without it Chromium runs WebRTC's canceller
in the page, whose reference is only WebRTC's own playout after the element's
volume: a voice panned through Web Audio would not be subtracted, and an element
at volume 0 would hand it silence. The setting off, or no panner in the browser,
also means the element. `?voice=spatial` skips the probe; the setting still wins.
**Nothing is built on the element tier from the start**: no node, the greeting
never taken in, the page as it was before.

**What moves him to the headset,** each on its own, for the rest of the page's
life (a reload tries again): an interruption within 300 ms of his voice starting,
measured from the audio (−45 dBFS after half a second of quiet) rather than from
the SDK's lagging mode; two interruptions with no transcript of the user between
them; a transcript of the user that repeats a line of his from the last ten
seconds (`echo-transcript.ts`: half their words shared, or four in a row, and
never on fewer than three words); the AudioContext stopped for half a second; and
LiveKit's server saying he is speaking while under 1e-4 reaches the panner for
1.5 s — the server's word, because WebRTC's own received level is measured after
the element's volume and reads nothing at volume 0. Moving restores the element's
volume at once, fades the panner branch out and disconnects it; the analyser
stays. A greeting already taken into Web Audio plays centred through a dry branch
from then on, and one whose AudioContext has stopped is reported refused, so the
agent says its own first line instead of him greeting in silence.

**The half-duplex fallback waits its turn** through `halfDuplexMayJudge` (a hook
only the headset passes to `hologram`'s session): it counts no interruption while
he is spatial, since an echo there moves him to the headset first, nor for three
seconds after he moves, while the browser's echo canceller settles on the
reference it has just been given. The session's `onInterruption` and `onMessage`
events are what the watch hears.

**What the session does on your behalf:** it calls `flushQueuedAudio` on the
room's agent tracks when interrupted; captions follow `written-reply.ts`, and only
while you are writing (the keyboard is up, or the last thing you said was typed —
a typed line that comes back as a transcript is recognised and ignored:
`createWrittenCaption`, hologram's `while-writing` rule); after a
dropped connection it removes the hidden `<audio>` elements the SDK leaves behind
(`orphaned-audio.ts`); and `quietFor(seconds)` tells the room how long his output
has been silent, for re-arming the wake word.

**Failure texts** (hologram's `failure-text.ts`) are the phone's wherever the phone
has one, on every device. The raw texts are replaced: the browser's "Failed to
fetch" (the headset says it in its own words, `HEADSET_OFFLINE_PROBLEM`), LiveKit's
text for a room it could not open ("The connection to ElevenLabs could not be
opened. The network may be blocking it."), and "LiveKit connection state changed
to disconnected". A message that looks like it contains a credential is never
shown.

`agent-room.contract.spec.ts` checks four things in the installed SDK: that it
still keeps the room on `connection.getRoom()`, that it builds that room from the
same `livekit-client` this app imports (so `instanceof Room` can match), that it
still uses the disconnect wording `describeDisconnect` looks for, and, at compile
time, that `Conversation.startSession` still fits `StartSession`. The session's own
behaviour is pinned in `hologram` (`jarvis-session.spec.ts` and
`jarvis-session-conversation.spec.ts`, set up the way `createHeadsetSession` sets
it up, driven by the fakes in `jarvis-session.fakes.ts`, which fire callbacks in
the SDK's own order); `headset-session.spec.ts` checks the headset really does set
it up that way. `greeting-recording.ts` is the only
file that imports `?url`, so `bun test` never loads it; `mp3-url.d.ts` declares
only `*.mp3?url`, never hologram's numeric `*.mp3`, which horizon must not reach.

## How he is drawn (`src/hologram3d/`)

`src/hologram3d/` stands the phone's Jarvis in the room in three dimensions.
`createJarvisHologram3D(renderer, { assetBase })` is the whole of it for the app:
add `object` to the scene, set its position (the anchor), call `arrive()` on every
summon and `update(delta, drive, centreEye)` once per XR frame before
`renderer.render`, with the centre eye read from `frame.getViewerPose` at the start
of the frame (three's XR camera lags one). `?flat` (`mode = 'flat'`) draws the
phone's whole picture on one quad instead: the first thing this app ever drew, kept
as the reference the 3D look is checked against.

Per frame, on the CPU:

1. **The phone's clock** (`frame-clock.ts`): hologram's frame clock, the one
   `hologram-view.tsx` steps in its frame callback — `advanceFrameClock` behind the
   `frameStepSeconds` gate, drawn through `hologramFrameOf`: the voice eased per
   frame, the tracker stepped on the raw reading, thinking and leaving faded at
   their fixed rates, the lattice eased. This file keeps only what the headset does
   differently: the voice is read every READ_INTERVAL_MS on the clock's own time,
   and the arrival restarts on `arrive()` (`restartArrival`).
2. **`analyseFrame`**, and CanvasKit drawing everything flat — the whorl, the core,
   the rim, the chips, the pulse — at **density 0**, which skips the body and the
   stream and nothing else (`flat-hologram.ts`). CanvasKit is the full build React
   Native Skia's web API expects, from `./vendor/`, wrapped in `JsiSkApi` exactly as
   hologram's own tests and the phone's web build do. Its surface is WebGL when
   there is a real GPU and its CPU rasteriser otherwise: on SwiftShader the GPU
   backend took about a second a frame and the CPU one under a tenth of that.

On the GPU:

3. **The halo union** (`halo-union.ts`), once a frame, before either eye: every lit
   fragment's halo as a capsule, MAX-blended into a 1024×512 byte target (R/G/B =
   dim/mid/bright coverage; the pinned fragments in the left half, the inner
   layer's in the right, as the phone paints them as separate paths). Stacked one
   by one, the halos were a flat orange coin; the phone strokes each tier's halos
   as one path, so they are a union.
4. **Per eye, the view-plane quad** (`view-plane-quad.ts`): CanvasKit's picture
   Screened with the halos' light, facing the centre eye.
5. **Per eye, the body's strokes** (`body-strokes.ts`): one instanced draw of
   view-facing glyph quads (dash, L, bracket, T, Z, ring, cell as distance fields,
   antialiased, never under 1.2 px) where each fragment really is, with the
   drawing's tier paints and sparkle.

Where each fragment is comes from `fragment-3d.ts`: the phone's per-fragment
helpers from `hologram`, with the body turning about the vertical in its own frame
(its front faces where the user stood when he arrived) and everything the phone
does on screen — the wander, the vortex, the lattice, the inner layer's turn, a
glyph's direction — done in the plane through his centre that faces the centre
eye. Depth is kept: the vortex scales it, the lattice snaps it into layers where
the centre eye sees them line up, the thinking plane is level with the floor.
`fragment-glsl.ts` is that file, line for line, in GLSL; each draw evaluates it in
its vertex shader (three 0.186 has no transform feedback, and a float state pass
needs an extension a Quest may not have). The unit tests hold `fragment-3d.ts` to
the phone; `hologram-port.spec.ts` holds the GLSL to `fragment-3d.ts`.

Blending (`layer-blending.ts`): Screen in colour and alpha, raw encoded sRGB — no
three.js colour management anywhere between Skia's bytes and the layer — and
alpha = ALPHA_FROM_LIGHT (0.85) × max(rgb). Why that alpha: passthrough is not
black, and what the page writes as alpha is how much of the room it hides; 0 would
be pure added light, which washes out in a bright room, and max(rgb) is Screen
against the room. It is to be tuned on a headset. Every part is drawn unfaded and
the fade is the blend's constant colour, so arriving, leaving and the close-range
guard fade him as one layer, exactly as the phone's saveLayer does. He fades out
when the head comes within 2.5R, and is gone inside 1.5R. Density is 1, with a
backstop that halves it for good if three frames in thirty are late
(`density-backstop.ts`). R is 0.22 m at rest (`dimensions.ts`); placement may
squeeze him to 0.13 m.

Known deviations from the phone: strokes of one tier that cross add up rather than
forming a union, so the arrival's first half-second and the listening knots are a
little hotter; everything CanvasKit draws is flat in the view plane.

## The preview page

`preview.html` (`src/preview/`), published at /hey-jarvis/horizon/preview.html:
Jarvis in 3D on a normal desktop canvas, with a camera to drag round him, black or
passthrough grey behind him, a button for each phase (arriving, greeting,
speaking, listening, thinking, idle, leaving — driven by the greeting's
measurement, the simulated voices and a simulated listener, as sample mode is),
flat or 3D, and the alpha factor. **Enter your room** opens the same hologram in a
headset, 1.6 m ahead; there a select moves on to the next phase. It is what the
browser tests photograph and measure, through `window.__hologramPreview`
(`preview-hook.ts`).

## The demo video

`.scripts/render-demo.ts` films the app in the browser tests' emulated Quest 3 and living room and
encodes a WebM (VP9 and Opus):

    timeout 300  bunx turbo build --filter=horizon
    timeout 3600 bun horizon/.scripts/render-demo.ts --out horizon-demo.webm

36 s at 1280x720 and 30 fps takes about a quarter of an hour. `--seconds N` stretches or squeezes
the whole shot (`--seconds 8` is a five-minute draft with every beat); `--size`, `--fps` and `--fov`
(vertical, 66° by default — IWER's 90° leaves him a speck) set the picture; `--frames dir` and
`--keep-frames` keep the PNGs, which are otherwise deleted after the encode; `--readme` also writes the
README's copies beside the WebM — an animated WebP (quality 95, every frame, 1280 wide) and a 640-wide
15 fps GIF behind it — because GitHub plays no video from a repository, and the README links the WebM for
the sound. The README's copies are `docs/jarvis-in-a-room.{webm,webp,gif}`. It needs an ffmpeg with
libvpx-vp9 and libopus — FFMPEG_PATH, else the one on the PATH; Playwright's own is VP8-only.
CHROMIUM_EXECUTABLE_PATH works as it does for the browser tests.

**The shot** (`demo-shot.ts`, pure, pinned by `demo-shot.spec.ts`): the real room, entered with a key,
waiting with its hint, the head glancing so the hint is seen trailing the gaze; a cut, from the same
pose, to sample mode — the real room cannot summon him without ElevenLabs — where he is placed 1.6 m
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

## The wake-word models, and their licence

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

## The honest limits

- **Every session starts with a tap.** An immersive session can only be requested
  from a user gesture, so the page's **Enter your room** is the way in; "Hey
  Jarvis" works from inside the room. Removing that tap needs the app packaged
  (below).
- **His voice comes from where he stands only on a headset with an echo
  canceller of its own**; otherwise from the headset, as the SDK's `<audio>`
  element plays it, which is what the browser's own echo canceller knows to
  subtract. Whether a Quest registers one with Android is not known until one is
  asked (the HUD's voice line says `echo canceller platform` or `browser`); if it
  does not, every Quest hears him from the headset, exactly as before. A voice
  that moves between the ears as the head turns is harder for any echo canceller,
  which is why his is watched and moved back at the first sign of trouble.
- **Packaging as an app needs an origin-root `assetlinks.json`.** An immersive PWA
  packaged with Bubblewrap needs Digital Asset Links at
  `https://ffmathy.github.io/.well-known/assetlinks.json`, which a project Pages
  site cannot publish — it needs the user-site repository, a custom domain or
  another host.
- **The wake-word models are CC BY-NC-SA 4.0** (above).
- **Pages shows the last release**, not the latest push (see "Publishing" below).
- **No service worker.** The wasm in `vendor/` and the models are not
  content-hashed, so a cache-first worker would serve an old `canvaskit.wasm` to a
  newer CanvasKit loader after a dependency update, and a network-first one would
  buy only an offline start, which a conversation over the network cannot use.
  Add one when there is a way to version its cache with the build. There is a web
  manifest and an icon.

## What only a real headset can tell

- **The microphone.** Whether the SDK's microphone request works while the wake
  stream stays open; whether echo cancellation, noise suppression and gain control
  hurt detection (`?microphone=raw` is there to try); whether the 16 kHz context
  really runs at 16 kHz (`?debug`'s wake audio line); how the microphone, the
  contexts and the worker behave through blur, sleep, taking the headset off, "Hey
  Meta" and system mute; false wakes per hour in a real room;
  `permissions.query('microphone')` in Quest Browser, and the guidance's path (lock
  icon → allow → reload).
- **The conversation.** Whether the echo canceller is good enough, and whether the
  half-duplex thresholds are right; whether Quest Browser feeds a remote WebRTC
  track to the analyser while the SDK's element plays it; whether the greeting
  plays inside `immersive-ar` after `prime()`; whether remote tracks read `ended`
  after a network drop; whether `vad_score` and tool events arrive at all, which
  depends on the agent's `clientEvents`.
- **His voice from where he stands.** Everything past the probe: whether Quest
  Browser offers `'all'` at all (`?debug`'s voice line reads `voice spatial (the
  headset cancels echo)  echo canceller platform` when it does, and `voice element
  (only the browser cancels echo)  echo canceller browser` when it does not, and
  `voice half-duplex (…)` once the session mutes the microphone while he speaks);
  whether his spatial voice stays out of the microphone while the head turns —
  talk to him for a few minutes turning your head, and the line should still say
  `spatial`, not `element (echo: …)`; whether Quest Browser pulls his track into
  Web Audio with its element at volume 0 (a `silent through the panner` demotion
  says it does not); whether the volume rocker still changes him; whether 1.6 m
  sounds like 1.6 m; and whether an AudioContext created before the microphone
  opened — the Enter tap when the permission was already granted — gets the same
  Android audio usage as the rest.
- **The room.** Which labels, planes and meshes Quest actually reports and whether
  the room scan arrives; how its change times behave; whether an updated mesh
  arrives in new arrays; how much scene anchors jitter against the 1 cm / 0.3°
  tolerance, and how often `reset` fires on recentre; whether the viewer-space
  hit-test fan returns depth hits; whether anchors resolve in time; how fast the
  grid builds on the XR2 Gen 2; whether 1.6 m, the 35° cone and the height rule
  feel right.
- **Drawing.** What CanvasKit costs on its GPU surface, and whether copying its
  picture into three's context every frame stalls at 72/90 Hz; the halo and stroke
  passes' cost at 0.8, 1.6 and 2.6 m; the alpha factor in a bright and a dim room;
  whether 1.2-pixel hot cores shimmer; whether the projection layer composites as
  the spec says; stereo comfort; whether `updateTargetFrameRate` behaves.
- **The rest.** Whether the system keyboard appears for a hidden textarea and
  blurs the session as Meta's docs say; holds and pinches with hand tracking;
  whether the text sizes and backings read well over real passthrough; the 2D
  page's size on Quest Browser's panel; the wake engine's time per chunk.

## Opening it on a Quest

- **Published:** see "Using it on a Quest" above.
- **From a branch:** start the **Mobile Web** workflow by hand from the Actions tab
  on that branch (see below); its build is then at the same URL once the run
  finishes, until the next release or manual run replaces it.
- **From a dev server:** WebXR needs HTTPS or `localhost`. With the headset on
  USB, `adb reverse tcp:5173 tcp:5173` makes the dev server `localhost` on the
  headset, then open `http://localhost:5173/`.
- Room data comes from the headset's Space Setup; Quest Browser asks for the
  spatial permission when a page wants planes or meshes, and a page can be
  refused it — so nothing about the room is required.

## The browser tests

`tests/e2e/` runs the real build in headless Chromium with an emulated headset:

- **The headset.** Meta's Immersive Web Emulation Runtime (`iwer`) as a Quest 3.
  Chromium has a native `navigator.xr` that refuses `immersive-ar`, and IWER
  **silently does nothing** unless installed with
  `installRuntime({ forceInstall: true })`. It fires `select` when the trigger goes
  down, before `selectstart`; a Quest fires it on release. The room reads a
  `select` with no start as a tap, so a quick press is a tap on both.
- **The room.** `@iwer/sem`'s Synthetic Environment Module with its bundled
  `living_room` capture (`device.installSEM(SyntheticEnvironmentModule)`, then
  `await device.sem.loadDefaultEnvironment('living_room')` — the README's
  `installSyntheticEnvironmentModule` is stale). It draws the room on its own
  canvas behind the app's and reports its planes, furniture boxes and room mesh as
  `XRPlane`s and `XRMesh`es. No network: the captures are in the package.
- **How it gets in.** `xr-harness.ts` runs in the page. `fixtures.ts` bundles it
  (and any other init script, like `room-probe.ts`) with the root `esbuild` at
  test time and injects it with `page.addInitScript`, so it is in place before the
  app's first line and never near the production bundle. It stands the head at
  1.6 m at the living room's south end, looking north.
- **Offline.** Every request to anything but `localhost` is aborted. The app specs
  answer ElevenLabs' token endpoint themselves (`app-driver.ts`); LiveKit's socket
  stays closed, so a summon that gets a token fails to connect, as it would on a
  network that blocks it.
- **The fake microphone.** Chromium's fake capture device, with the permission
  granted. `app-wake-word.spec.ts` runs in a Playwright project of its own whose
  microphone plays `src/wake/fixtures/hey-jarvis-american.wav` on a loop
  (`--use-file-for-fake-audio-capture` is a launch flag); `wake.spec.ts` launches
  a Chromium per clip for the bare pipeline.
- **Served like Pages.** `.scripts/serve-dist.ts` serves `dist/horizon` under
  `/hey-jarvis/horizon/` only, so an absolute asset URL 404s here as it would on
  the site. The port is `HORIZON_E2E_PORT`, 8098 by default (the phone's suite has
  8099); give each checkout its own when suites run side by side. A server already
  on the port is only reused when `HORIZON_E2E_REUSE_SERVER=1` asks — it may be
  another checkout's, serving another build.
- **What the app shows the tests.** `window.__jarvis` (`src/debug-hook.ts`): the
  phase, frames drawn, where he was placed and where the head was, how the
  placement went (level, clearance, radius), how many wakes there have been, the
  room's scene, view and recent effects, the last problem, and where his voice
  comes from (route, tier, reason, the probe, the setting, how the greeting is
  heard, and where the listener and the panner were last put).
- **His voice.** `app-voice.spec.ts` makes the fake microphone offer `'all'`, as a
  headset with its own echo canceller would, records the panners and the elements
  the page takes into Web Audio, and checks the greeting goes through an HRTF
  panner at his anchor with the listener following the emulated head, a stopped
  AudioContext moving him back, and the page's setting. His live track cannot be
  played offline, so its route through the panner and the echo signs are the unit
  tests'; `element-volume-probe.ts` checks the rule for the SDK's elements on real
  elements playing real streams.
- **Slow frames.** SwiftShader draws the room at about eight frames a second while
  he is away and about one and a half while he is there, and his clock moves at
  most a tenth of a second a frame. A session gives up on a token after twenty
  seconds, so the specs that keep him greeting do their work inside that. A
  picture takes the emulator seconds, so a picture of an error panel, which is up
  for six, counts only if the panel is still up once the picture is back —
  otherwise the next failure is photographed.
- **Pictures.** The app specs photograph the view — waiting with the hint,
  arriving, greeting, both error panels and every sample mood — and the hologram
  specs every phase; each is attached to the report, and copied to
  `HOLOGRAM_SCREENS_DIR` when that is set. `hologram-room.spec.ts` logs the
  emulator's frame times, which say nothing about a Quest's.

What IWER does not cover: projection layers (it only has `XRWebGLLayer`, so the
path Quest actually composites is not exercised), `fixedFoveation`,
`initiateRoomCapture`, and anything about the microphone inside an immersive
session. `@iwer/sem` also brings its own three.js 0.184 — test-only, since the
harness is only ever bundled into an init script.

## Publishing: GitHub Pages, shared with the phone

`.github/workflows/mobile-web.yml` builds this package (`bunx turbo build
--filter=horizon`) before the phone's web export, assembles one site — the phone
app at the root, `dist/horizon` in `horizon/` — and publishes it. Vite's
`base: './'` makes every asset URL relative, so the same build works at any
sub-path and needs no base-path variable.

**It publishes for releases only.** `release.yml` calls the workflow with the tagged
commit once Release Please has cut a release; pushes and pull requests publish
nothing. It can be started by hand on any branch, which is how a branch's build
gets onto a headset before it is merged. Pages keeps one live site and the last run
wins, and a manual run from a branch cut before this package existed publishes the
phone app alone, taking `/hey-jarvis/horizon/` off the site until the next run from
a branch that has it.

## CI

`build.yml` runs `bunx turbo e2e --filter=horizon` on a line of its own after the
phone's, so the two suites never run at once. The Playwright config keys its CI
behaviour on `GITHUB_ACTIONS`, which the workflow passes into the dev container
(`CI` is not passed).

`horizon#initialize` is uncached in `turbo.json`: it writes gitignored files, so a
cache hit would replay its log, restore nothing, and the build would publish a
site with no CanvasKit.

## Scope Guidelines for Commits

Use the `horizon` scope: `feat(horizon): …`, `fix(horizon): …`,
`test(horizon): …`. A change to the shared drawing is `hologram`'s, even when it
is made for the headset.
