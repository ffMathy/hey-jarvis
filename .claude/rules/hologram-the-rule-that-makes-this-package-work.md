---
paths:
  - "hologram/**"
---

# The rule that makes this package work

> Part of [Hologram](hologram.md). Paths in it are relative to `hologram/` unless they say otherwise.

**Nothing in the main entry imports a value from outside the package.** Its
modules import each other, and everything else they import is `import type`.
That is not tidiness; it is the reason the same scene, frame clock and
conversation run in four places:

- a Reanimated worklet, on a phone or a watch;
- the browser build published to GitHub Pages;
- `bun test`;
- the headset, which has no React at all.

`main-entry.contract.spec.ts` holds every module directly in `src/` to it, by
parsing them with Bun's own transpiler: an import or re-export not marked as a
type, from anywhere but a sibling, fails it. A path into `./react`,
`./conversation` or `./gpu` counts as outside, since those are other entries.
Mark a type-only import `import type` (or each specifier `type`) even where a
bundler would drop it anyway — the test counts what the source says. Until the
GPU drew all of him it had one exception, Skia's enums, which the drawing read
as values.

The two ElevenLabs files keep the same rule for the same payoff. `fetch` is a
global rather than an import, so the token request and every failure ElevenLabs
can answer with — a rejected key, a key without permission, an unknown agent, an
account out of credits, a rate limit — are driven in `conversation-token.spec.ts`
with no account, no credential, no SDK and no device.

**`hologram/gpu` keeps the same rule.** It runs in four places too — under `bun
test`, in the headset's browser beside three.js, in the phone's web build and on
a phone or a watch beside expo-gl — and imports none of them. The headset wraps
its body's shader sources in three.js materials (`vr/src/hologram3d/`), and the
raw renderers — `createGpuBody` and `drawGpuBody`, `createGpuPicture` and
`drawGpuPicture`, and `drawGpuFrame` for both — take the GL context as an
argument typed as `HologramGl` (`gl-objects.ts`), a `Pick<>` of
`WebGL2RenderingContext` naming the calls they make, which a browser's context,
expo-gl's and three.js's own all fit; the GL enums are numbers in the module
rather than read off the context. Adding a call means widening that pick, which
is the point: the type says exactly how much of WebGL he needs. Its modules
import the main entry's modules directly (`../hologram-drawing`,
`../frame-timing`), never the `..` barrel, for the reason under "Worklets"
below. `gpu.contract.spec.ts` holds it to both, parsing every module with Bun's
transpiler as the main entry's contract does: a value from anything but a sibling
or one module directly in `src/` fails it, and so do the `..` barrel and the
other entries (`../react`, `../conversation`). Biome reads `gl.useProgram` as a
React hook, so `biome.json` turns `useHookAtTopLevel` off for that folder alone,
where nothing is React.

What runs every frame there is a worklet — `drawGpuFrame`, `drawGpuBody`,
`drawGpuPicture` and everything they call, `placeFlatCamera`,
`writeFragmentUniforms` and the view-basis maths — so an app can draw on
whichever thread holds its context. `createGpuBody` and `createGpuPicture` are
JS-thread code: they build the rows and the picture's layers, compile the
programs and upload about 3 MB of vertices and tables, once, and throw when the
context refuses any of it (an ES 2 context cannot compile the GLSL ES 3.00
shaders), which is the app's cue not to draw him. On a phone what they return then crosses to the UI thread,
and worklets copy nothing between runtimes but plain objects, arrays and typed
arrays, while expo-gl makes every GL object an instance of a class of its own.
So the body and the picture keep a plain `{ id }` in place of each of expo-gl's,
which is all expo-gl reads of one, and a browser's as they are; `gpu-body.spec.ts`
and `gpu-picture.spec.ts` hold them to that with a context that makes them the way
expo-gl does (`recording-gl.fakes.ts`). Nothing deletes
what it made: it goes with the context, and a GL call from the JS thread while
the UI thread draws could race it. The renderer leaves GL state as it set it, so
it needs a context of its own. It draws what the headset draws, pass for pass and in
three's order — the halo union into its own target, then the strokes, then the
halos' light, Screened and faded as one layer — and whether the pixels agree is
a browser's to say: vr's `hologram-gpu-body.spec.ts` draws the same moments both
ways in Chromium, from the matrices three drew with, and fails on one byte
apart. The picture draws what Skia drew, layer for layer, and vr's
`hologram-picture.spec.ts` holds it to frames Skia drew before it went. Here,
`gpu-body.spec.ts` and `gpu-picture.spec.ts` check the passes, their targets and
their blending against a context that writes its calls down.

`src/react/` is where React, Reanimated and expo-gl are called for real, and it
is deliberately thin: one GL canvas, a frame callback that draws him into it,
the voice read every 40 ms, and the tracker stepped on the UI thread. It takes a `JarvisVoice` and asks it
two questions — nothing in it knows where the audio came from, so the phone can
hand it a WebRTC track and the watch its own microphone.

The view times how long each frame's JavaScript takes — the calls that issue the
GPU's frame — which is what the density loop in `density-control.ts` steers by,
with the frame rate as its backstop.

`src/conversation/` is where the ElevenLabs SDK is called for real, and it is
thinner still: `useJarvisSession` hands the main entry's session
`Conversation.startSession`, the greeting's player, the call's audio and a
timer, and holds its snapshot in React. Every rule of the conversation is the
main entry's — see below.

If you find yourself wanting a microphone, a permission prompt, a navigation
decision or a screen layout in any of the four, it belongs in the app, not
here.
