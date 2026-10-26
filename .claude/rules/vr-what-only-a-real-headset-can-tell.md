---
paths:
  - "vr/**"
---

# What only a real headset can tell

> Part of [VR](vr.md). Paths in it are relative to `vr/` unless they say otherwise.

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
- **Drawing.** What the picture's few dozen draws into its 512-pixel target cost
  on a Quest's GPU each frame, and whether switching into that target and back
  costs a tiled GPU more than it should at 72/90 Hz; the halo and stroke
  passes' cost at 0.8, 1.6 and 2.6 m; the alpha factor in a bright and a dim room;
  whether 1.2-pixel hot cores shimmer; whether the projection layer composites as
  the spec says; stereo comfort; whether `updateTargetFrameRate` behaves; whether
  the density backstop's second of grace covers a summon and its ten seconds and
  two windows are the right numbers — the HUD's `density` shows it halve and come
  back.
- **Smooth edges and text.** What four samples a pixel cost in Quest Browser
  (the HUD's frame time, against a build with `antialias: false`), and whether its
  projection layer takes the render-to-texture path: the HUD's `gl` line has to
  list `WEBGL_multisampled_render_to_texture`, and three only uses it when the
  layer ignores depth. The room submits a depth buffer nothing is drawn into; if the
  samples cost more than Meta's half to one and a half milliseconds, `depth: false`
  in `RENDERER_PARAMETERS` is the next thing to try. Whether the panels' text is as
  sharp as it should be at the hint's 1.3 m and the drawer's half metre, and whether
  the half-level sharpening shimmers as the head moves; whether the tokens' rings
  crawl across the room, where they are a pixel or two wide.
- **A phone.** Whether Chrome on Android grants `local-floor`, which the session
  requires, on every ARCore phone; whether a tap's `select` arrives with a pose
  for its ray; whether the transient-input hit test finds the room fast enough
  for a drag; whether the 6° tap cone (`TAP_CONE_DEGREES`) is the size of a
  fingertip on a real screen; and whether the wake word's microphone and the
  camera can run together.
- **Placing things.** How long persistent anchors take to restore and locate, how
  they behave across rooms, what `requestPersistentHandle` says at the limit of
  eight per origin, whether other Pages projects on `ffmathy.github.io` already
  hold some, and whether `anchors` brings up the spatial permission prompt; hand-ray
  jitter against the 7° and 4° cones and the 0.28 s dwell; the 1.5/3 cm pinch and
  the 40°/55° wrist thresholds on real joints — in particular whether a hand held
  palm down close under the eyes reads as a raised wrist and pops the button up
  (only a wrist turned across the body should); whether Quest fires `squeeze` for
  hands (the app reads joints, so it should not matter); whether the depth hit test
  finds thin fixtures such as a pendant lamp for a far drop; how the corona's alpha
  looks over real passthrough; and whether the system keyboard or the palm pinch
  ever gets in the way of the drawer, the wrist button or a grab. Whether the
  agent's server replaces a context update with the same `context_id` or adds to
  it, and whether it reliably passes names.
- **The rest.** Whether the system keyboard appears for a hidden textarea and
  blurs the session as Meta's docs say; holds and pinches with hand tracking;
  whether the text sizes and backings read well over real passthrough; the 2D
  page's size on Quest Browser's panel; the wake engine's time per chunk.
