# Horizon

Jarvis in your room, on a Meta Quest. A WebXR page that opens an `immersive-ar`
(passthrough) session and shows him standing in the room with you — the same
hologram the phone and the watch draw, from the same `hologram` package.

> **Note:** See the root [AGENTS.md](../AGENTS.md) for shared conventions (Turborepo commands, commit standards, 1Password, etc.)

## Where it is today

This package is at **Milestone 0**: the scaffold, and the proof that the
phone's drawing can be put in a room. The page has one button, **Enter your
room**; the session places Jarvis 1.6 m ahead of your head, at eye height, and
draws him there idling, turned to face you every frame. There is no wake word,
no conversation and no room understanding yet — those are the phases below, and
the models and dependencies for them are already in place.

The end state, which the architecture below is laid out for: open the page in
Quest Browser, enter the room, say "Hey Jarvis", and he appears where there is
space in front of you, greets you and holds the full ElevenLabs conversation,
then leaves and listens for the wake word again.

## What is in here

```
index.html                 the 2D page: the button, a status line, the models' attribution
src/main.ts                wires the page to the room; loads three and CanvasKit apart from the page
src/debug-hook.ts          window.__jarvis, what the browser tests read (see below)
src/xr/room-session.ts     the immersive-ar request: only local-floor required, the rest optional
src/xr/room-view.ts        the session's renderer and frame loop
src/xr/viewer-pose.ts      the centre eye from the viewer pose; the point ahead along the floor
src/hologram3d/            the phone's drawing on a view-facing quad (details below)
src/wake/models.spec.ts    pins the committed wake-word models' SHA-256
public/models/             the openWakeWord models and their LICENCE.txt (committed)
public/vendor/             canvaskit.wasm and onnxruntime-web's wasm (gitignored; see initialize)
tests/e2e/                 Playwright: the emulated headset and room, and the specs
.scripts/initialize.sh     copies the wasm out of node_modules into public/vendor/
.scripts/build.sh          vite build into ../dist/horizon
.scripts/test.sh           bun test over every *.spec.ts outside tests/e2e
.scripts/serve-dist.ts     serves the build under /hey-jarvis/horizon/ for the browser tests
```

Where the later phases go, as planned:

```
src/page/          the 2D page proper: ElevenLabs settings, model loading progress, microphone, last problem
src/app/           the app's state machine, select/pinch gestures, lifecycle, sample mode
src/xr/            input, hit-test fan, anchors, frame rate, room snapshot
src/room/          choosing where he stands (pure TypeScript) and its worker
src/wake/          microphone, AudioWorklet, the onnxruntime-web worker pipeline, watchdog
src/conversation/  the ElevenLabs session, the greeting, his voice and yours, tool activity
src/hologram3d/    the frame clock, the volumetric body, the halo union, the compositor
src/ui3d/          text in the room: the hint, status line, error panel, captions, debug HUD
```

## Commands

```bash
timeout 60  bunx turbo initialize --filter=horizon   # the wasm into public/vendor/ (the build runs it too)
timeout 300 bunx turbo build --filter=horizon        # initialize, lint, typecheck, then vite build → dist/horizon
timeout 300 bunx turbo test --filter=horizon         # the offline unit tests
timeout 600 bunx turbo e2e --filter=horizon          # the browser tests, against a fresh build
timeout 60  bunx turbo lint --filter=horizon
bunx turbo serve --filter=horizon                    # Vite's dev server on the LAN (persistent: run it in the background)
```

`serve` does not run `initialize`; run that once first, or CanvasKit's wasm is
missing and the room opens empty.

## How he is drawn (Milestone 0)

`src/hologram3d/` puts the phone's whole drawing — `drawHologram` from
`hologram`, density 1, every layer — on one square in the room:

1. **CanvasKit draws him flat.** `canvaskit.ts` loads CanvasKit's full build
   (the one React Native Skia's web API expects) from `./vendor/`, and wraps it
   in `JsiSkApi`, exactly as `hologram-drawing.spec.ts` and the phone's web
   build do. `flat-hologram.ts` draws each frame into a 512² OffscreenCanvas
   cleared to opaque black and hands it over with `transferToImageBitmap`.
   The surface is WebGL when there is a real GPU and CanvasKit's CPU rasteriser
   otherwise: on SwiftShader (any machine without a GPU, including CI) the GPU
   backend took about a second a frame and the CPU one under a tenth of that.
2. **A quad shows it.** `view-plane-quad.ts` is a 3.7R square
   (R = 0.22 m, `dimensions.ts`; 3.7 is 1 / `SPHERE_FRACTION`), turned every
   frame to face the centre eye, with a raw shader that Screen-blends the
   picture over the room — `ONE, ONE_MINUS_SRC_COLOR` in colour and
   `ONE, ONE_MINUS_SRC_ALPHA` in alpha — writing alpha = 0.85 × max(rgb). Why
   that alpha: passthrough is not black, and what the page writes as alpha is
   how much of the room it hides. 0 would be pure added light, which washes out
   in a bright room; max(rgb) is Screen against the room. It is to be tuned on
   a headset.
3. **Raw colour.** No three.js colour management anywhere between Skia's bytes
   and the layer: the texture is `NoColorSpace`, the material is a
   `RawShaderMaterial`. The projection layer is treated as sRGB and
   premultiplied, so blending encoded values matches the phone's Screen.

`room-view.ts` reads the centre eye from `frame.getViewerPose` at the start of
each frame, not from three's XR camera, which lags a frame. The renderer is
`WebGLRenderer({ alpha: true, antialias: false, premultipliedAlpha: true })`,
foveation 0.3.

Later phases replace the flat body with a volumetric one (the body strokes in
true 3D, a halo-union pass, CanvasKit drawing only the layers that are flat);
this path stays as a `?flat` debug switch.

## The wake-word models, and their licence

`public/models/` holds openWakeWord's `melspectrogram.onnx`,
`embedding_model.onnx` and `hey_jarvis_v0.1.onnx`, **byte for byte** its v0.5.1
release assets, committed so the build needs no network and so the site never
depends on a third-party download (GitHub's release URLs send no CORS headers,
so a browser could not fetch them anyway). `src/wake/models.spec.ts` pins their
SHA-256; a different file fails the suite.

**They are CC BY-NC-SA 4.0**, by David Scripka — not this repository's licence.
Attribution is in `public/models/LICENCE.txt` (published with the site) and in
the page's footer. Non-commercial: anyone using this app commercially has to
replace the models first.

## Opening it on a Quest

- **Published:** https://ffmathy.github.io/hey-jarvis/horizon/ in Quest
  Browser. Quest 3 and 3S are the target; Quest 2 and Pro work without meshes.
- **From a branch:** pushing a `claude/**` branch republishes the site (see
  below), so a branch's build is at the same URL once its workflow run
  finishes.
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
  `installRuntime({ forceInstall: true })`.
- **The room.** `@iwer/sem`'s Synthetic Environment Module with its bundled
  `living_room` capture (`device.installSEM(SyntheticEnvironmentModule)`, then
  `await device.sem.loadDefaultEnvironment('living_room')` — the README's
  `installSyntheticEnvironmentModule` is stale). It draws the room on its own
  canvas behind the app's and reports its planes, furniture boxes and room mesh
  as `XRPlane`s and `XRMesh`es. No network: the captures are in the package.
- **How it gets in.** `xr-harness.ts` runs in the page. `fixtures.ts` bundles it
  with the root `esbuild` at test time and injects it with
  `page.addInitScript`, so it is in place before the app's first line and never
  near the production bundle. It stands the head at 1.6 m at the living room's
  south end, looking north.
- **Offline.** Every request to anything but `localhost` is aborted.
- **Served like Pages.** `.scripts/serve-dist.ts` serves `dist/horizon` under
  `/hey-jarvis/horizon/` only, on port 8098 (the phone's suite has 8099), so an
  absolute asset URL 404s here as it would on the site.
- **What the app shows the tests.** `window.__jarvis` (`src/debug-hook.ts`): the
  phase, frames drawn, where he was placed and where the head was, which surface
  CanvasKit got, and the last problem.
- **Screenshots.** `smoke.spec.ts` saves `milestone-0-room.png` — the whole page,
  so the synthetic room behind the app's canvas is in it — into its
  `test-results/` folder, and attaches it to the report.

What IWER does not cover: projection layers (it only has `XRWebGLLayer`, so the
path Quest actually composites is not exercised), `fixedFoveation`,
`initiateRoomCapture`, and anything about the microphone inside an immersive
session. `@iwer/sem` also brings its own three.js 0.184 — test-only, since the
harness is only ever bundled into an init script.

## Publishing: GitHub Pages, shared with the phone

`.github/workflows/mobile-web.yml` builds this package (`bunx turbo build
--filter=horizon`) before the phone's web export, assembles one site — the
phone app at the root, `dist/horizon` in `horizon/` — and publishes it. Vite's
`base: './'` makes every asset URL relative, so the same build works at any
sub-path and needs no base-path variable.

**Caveat: older branches take the headset app off the site.** Pages keeps one
live site and the last run wins. A `claude/**` branch cut before this package
existed still runs its own copy of the workflow, which publishes the phone app
alone, so `/hey-jarvis/horizon/` returns 404 after such a push until the next
run from a branch that has horizon. Nothing in the new workflow can prevent
that; rebasing the old branches does.

**There is a web manifest and an icon, but no service worker yet.** The wasm
in `vendor/` and the models are not content-hashed, so a cache-first worker
would serve an old `canvaskit.wasm` to a newer CanvasKit loader after a
dependency update, and a network-first one would buy only an offline start,
which Jarvis — a conversation over the network — cannot use. Add one when
there is a way to version its cache with the build.

**Packaging as an app is not done.** An immersive PWA packaged with Bubblewrap
needs Digital Asset Links at the origin root
(`https://ffmathy.github.io/.well-known/assetlinks.json`), which a project
Pages site cannot publish — it needs the user-site repository, a custom domain
or another host. Until then, each session starts from the page's button.

## CI

`build.yml` runs `bunx turbo e2e --filter=horizon` on a line of its own after
the phone's, so the two suites never run at once. The Playwright config keys
its CI behaviour on `GITHUB_ACTIONS`, which the workflow passes into the dev
container (`CI` is not passed).

`horizon#initialize` is uncached in `turbo.json`: it writes gitignored files, so
a cache hit would replay its log, restore nothing, and the build would publish a
site with no CanvasKit.

## Scope Guidelines for Commits

Use the `horizon` scope: `feat(horizon): …`, `fix(horizon): …`,
`test(horizon): …`. A change to the shared drawing is `hologram`'s, even when it
is made for the headset.
