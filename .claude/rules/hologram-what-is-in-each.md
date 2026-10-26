---
paths:
  - "hologram/**"
---

# What is in each

> Part of [Hologram](hologram.md). Paths in it are relative to `hologram/` unless they say otherwise.

| Entry | Imports | What it holds |
| --- | --- | --- |
| `hologram` | types and its own siblings | the scene he is drawn from and the frame analysis behind it, the frame clock every device steps him on (`frame-clock.ts`) and the numbers it runs by (`frame-timing.ts`), the phone's tilt to look around (`tilt.ts`), the voice tracker, the simulated voices, sample mode's moods, the voices each mood hands the sphere (`sample-drive.ts`) and its readout text, the density control, the ElevenLabs credentials, how they are stored and the token request, and the conversation itself: the session every device holds it in (`jarvis-session.ts`, its shapes in `session-contract.ts`), what its failures say (`failure-text.ts`), which of his lines it writes down (`written-caption.ts`), the headset's half-duplex fallback (`half-duplex.ts`), what a request touches and what sir points at (`affected-entities.ts`: an entity's shape, its limits and its parser), which agents a request has at work (`agent-activity.ts`) and where the satellites they are drawn as are on a screen (`agent-work.ts`, `satellite-drawing.ts`), the line every device keeps to the Jarvis server during a conversation (`jarvis-server-link.ts`), and the pieces it is built from — whether a conversation is open or has ended and how long to wait for it (`conversation-life.ts`), which tool calls are in flight (`tool-activity.ts`), the latest `vad_score` (`vad-score.ts`), his voice as a browser plays it (`played-voice.ts`), finding his track in the room (`agent-audio-track.ts`), dropping what an interruption leaves queued (`queued-audio.ts`) and his last written line (`written-reply.ts`) |
| `hologram/gpu` | types, its own siblings and the main entry's modules — the context is handed in | all of him on the GPU: the body's fragment arithmetic in GLSL and the CPU reference it is held to (`fragment-glsl.ts`, `fragment-3d.ts`), the rows every pass reads and their vertices (`body-rows.ts`, `row-vertices.ts`), the halo union, the strokes and the halos' light as shader sources (`halo-union.ts`, `body-strokes.ts`, `halo-light.ts`), the sparkle's bytes (`sparkle.ts`), the view-basis maths (`view-basis.ts`), and the raw renderer the phone and the watch draw it with (`gpu-body.ts`) through the camera a flat screen needs (`flat-camera.ts`), placed where the phone's tilt puts the eye (`tilted-view.ts`); and the picture of the rest of him (`gpu-picture.ts`, its layers' shaders in `picture-layers.ts` and `picture-glsl.ts`, its gradients and the satellites' glyphs in `picture-gradients.ts` and `picture-glyphs.ts`), with a phone's and a watch's whole frame of both (`gpu-frame.ts`) |
| `hologram/react` | React, Reanimated, and expo-gl once its native module is found | the one GL canvas he is drawn on and what sets him up and finds its context each frame (`gpu-layer.tsx`, `gl-context.ts`), the tilt's sensor (`tilt-sensor.tsx`), and the frame callback that steps the frame clock and draws him |
| `hologram/react/sample` | React, Reanimated — not expo-gl | sample mode's clock-made voice, mood toast and frame-rate readout, shared by the phone's sample screen and the watch's waiting screen |
| `hologram/conversation` | React, `@elevenlabs/client`, `@livekit/react-native`'s audio session, hologram's own native greeting player (`expo-audio` in a browser) — not expo-gl | `useJarvisSession`, which hands the main entry's session the SDK, the greeting's player and the call's audio, and holds its snapshot for a screen |

`hologram/conversation`, `hologram/react/lifecycle` and `hologram/react/sample` deliberately do
**not** reach expo-gl: on a device it asks for its native module as it loads and throws in a build
without one, and only the view loads it, once it has found the module. That is why the
conversation hook is not simply part of `hologram/react`. `react.contract.spec.ts` holds all three
to it. They began as the same line drawn round Skia, which in a browser could not be touched before
CanvasKit had loaded.
