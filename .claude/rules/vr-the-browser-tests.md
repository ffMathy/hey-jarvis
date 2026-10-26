---
paths:
  - "vr/**"
---

# The browser tests

> Part of [VR](vr.md). Paths in it are relative to `vr/` unless they say otherwise.

`tests/e2e/` runs the real build in headless Chromium with an emulated headset:

- **The headset.** Meta's Immersive Web Emulation Runtime (`iwer`) as a Quest 3.
  Chromium has a native `navigator.xr` that refuses `immersive-ar`, and IWER
  **silently does nothing** unless installed with
  `installRuntime({ forceInstall: true })`. It fires `select` when the trigger goes
  down, before `selectstart`; a Quest fires it on release. The room reads a
  `select` with no start as a tap, so a quick press is a tap on both. Its
  `getOffsetReferenceSpace` takes a bare matrix, against the spec, and turns the
  spec's `XRRigidTransform` into NaNs — which leaves the new space silently where
  the old one was — so `xr-harness.ts` hands it the transform's matrix, and the
  `?origin` seam works as it does on a headset.
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
- **Served like Pages.** `.scripts/serve-dist.ts` serves `dist/vr` under
  `/hey-jarvis/vr/` only, so an absolute asset URL 404s here as it would on
  the site. The port is `VR_E2E_PORT`, 8098 by default (the phone's suite has
  8099); give each checkout its own when suites run side by side. A server already
  on the port is only reused when `HORIZON_E2E_REUSE_SERVER=1` asks — it may be
  another checkout's, serving another build.
- **What the app shows the tests.** `window.__jarvis` (`src/debug-hook.ts`): the
  phase, frames drawn, where he was placed and where the head was, how the
  placement went (level, clearance, radius), how many wakes there have been, the
  room's scene, view and recent effects, the last problem, and where his voice
  comes from (route, tier, reason, the probe, the setting, how the greeting is
  heard, and where the listener and the panner were last put), and the entities
  (see "Entities placed in the room").
- **Placing things.** `app-entities.spec.ts` walks the whole feature in five
  visits sharing one browser's `localStorage`, where both the registry and the
  emulator's persistent anchors live: **Place entities** and a controller's grip,
  Done; a new session opened with `?origin` moved and turned, where the entity must
  be found at the same spot of the room — the emulator's `local-floor` is its
  global space, so without a moved origin a position kept in `local-floor` would
  come back right for the wrong reason; a controller's ray and a pointing finger;
  A, a pinch, B; the wrist button; Done pulled with the trigger in a room with a
  conversation, held and let go without summoning him; sample mode's thinking
  lighting a corona round each placed entity (copied into sample mode's own
  registry, which is all it shows); and **Place entities** again, with a
  drop far from every anchor and Done in the same frame, kept before the room
  closes. `entities-driver.ts` holds the emulated head, hands and
  controllers, converts between the emulator's space and the room's, and measures
  where a hand pinches or a controller grips from the app's own report rather than
  copying the emulator's poses. `corona.spec.ts` photographs and measures the corona
  on a bare page (`corona-probe.ts`).
- **His voice.** `app-voice.spec.ts` makes the fake microphone offer `'all'`, as a
  headset with its own echo canceller would, records the panners and the elements
  the page takes into Web Audio, and checks the greeting goes through an HRTF
  panner at his anchor with the listener following the emulated head, a stopped
  AudioContext moving him back, and the page's setting. His live track cannot be
  played offline, so its route through the panner and the echo signs are the unit
  tests'; `element-volume-probe.ts` checks the rule for the SDK's elements on real
  elements playing real streams.
- **Slow frames, and the budgets the specs hold.** SwiftShader draws the room at
  about eight frames a second while he is away and about five while he is there
  (two, before his rows were one plain list rather than instances), half that on a
  loaded machine (a CI runner is no faster), and his clock moves at most a tenth
  of a second a frame. Two of the app's budgets run on the
  wall clock instead: the twenty seconds a summoning waits for its conversation,
  and the six seconds at least that an error panel is up. The specs that keep him
  greeting on a token that never comes, and the ones that photograph a panel (a
  picture takes the emulator seconds), raced them, and lost whenever the machine
  was busy: the scene went `failed` under a spec still waiting for its frames, or
  the panel went while its picture was taken. So the page reads two seams once,
  beside `?origin` (`src/test-seams.ts`), and `appPage()` in `app-driver.ts` opens
  it holding them. `?deadline=never` hands the session an infinite deadline, which
  arms no timer; `?errors=held` keeps the failed scene until a select or B, which
  is how those specs dismiss it. Without them the page is exactly what a headset
  runs, and the budgets themselves are the unit tests' (`jarvis-session.spec.ts` in
  `hologram`, `app/app-state.spec.ts`).
- **Why seams and not a faked clock.** `.scripts/render-demo.ts` films him on
  `page.clock`, paused, stepping each frame itself. The specs cannot: the greeting
  and the wake word run on real audio, which a paused clock does not hold, and every
  spec would have to step the emulator's frames by hand around every wait. For the
  same reason the greeting a spec keeps him in is served three minutes long
  (`lengthenTheGreeting`), longer than a test may run: it plays on the wall clock.
  Everything else is waited for by a condition — a frame count, a scene that holds,
  an effect, his placement — and never by a scene that lasts only as long as a
  two-second greeting.
- **Frame times.** The harness writes down the time of every XR frame
  (`window.__xrHarness.frameTimes`), and `fixtures.ts` reports each test's median
  interval with its result and in the log, so a failure on a slow machine says how
  slow it was. They are SwiftShader's on a CPU, and say nothing about a Quest's.
- **Pictures.** The app specs photograph the view — waiting with the hint,
  arriving, greeting, both error panels, every sample mood, and the drawer, a
  carried and a placed token, the pointing reticle and a corona round a placed
  entity (`entities-*.png`) — and the hologram
  specs every phase, from the front and the side, on black and on grey, and told
  apart by how each is lit; each is attached to the report, and copied to
  `HOLOGRAM_SCREENS_DIR` when that is set. `hologram-room.spec.ts` logs the
  emulator's frame times, which say nothing about a Quest's.
- **His picture alone.** `hologram-picture.spec.ts` holds the GPU picture of
  everything but his body to Skia's goldens of fourteen moments
  (`fixtures/picture/`), and `hologram-picture-behaviour.spec.ts` carries what
  were `hologram`'s pixel tests under CanvasKit — of him and of his satellites,
  with their thresholds as they were — onto it. Both draw through the preview's
  hook into a target of the stage's own renderer, as the headset draws him, and
  the behaviour spec measures each picture faded by `arrivalOf` as a view fades
  it (see "How he is drawn").
- **Pictures at a headset's density, nearly.** The emulator's XR framebuffer is
  the window's size in CSS pixels — IWER sets its canvas to `innerWidth` by
  `innerHeight` whatever the device pixel ratio, and its synthetic room would size
  its own canvas again on every frame at any ratio but 1 — so only a larger window
  gives more pixels per degree. `app-entities.spec.ts` and `hologram-room.spec.ts`,
  whose pictures are for judging how things look, open 2560 by 1440
  (`ROOM_PICTURE_VIEWPORT` in `fixtures.ts`): about 12.6 pixels per degree in the
  middle of IWER's 90° view, half a Quest 3's 25, where the default 1280 by 720 has
  a quarter and makes every edge look four times as jagged as a headset would. The
  other specs keep the default: four times the pixels slows every SwiftShader
  frame, and their pictures are for what is shown, not how finely.

What IWER does not cover: projection layers (it only has `XRWebGLLayer`, so the
path Quest actually composites is not exercised, and the four samples in its
pictures are the page canvas's own, not a render into a layer), `fixedFoveation`,
`initiateRoomCapture`, anything about the microphone inside an immersive
session, the eight-anchor limit, a persistent anchor that fails to restore or
takes time to relocalise (its anchors are unlimited and always located), and a
squeeze from a hand. Its hands are three rigid poses — relaxed, pointing,
pinching — blended by the pinch value. `@iwer/sem` also brings its own three.js 0.184 — test-only, since the
harness is only ever bundled into an init script.
