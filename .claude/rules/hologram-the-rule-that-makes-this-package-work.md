---
paths:
  - "hologram/**"
---

# The rule that makes this package work

> Part of [Hologram](hologram.md). Paths in it are relative to `hologram/` unless they say otherwise.

**Nothing in the main entry imports a value from outside the package**, with one
exception. Its modules import each other, and everything else they import is
`import type` — apart from `hologram-drawing.ts`, which takes Skia's enums
(`BlendMode`, `StrokeCap` and the rest) as values from the package's type
module, `@shopify/react-native-skia/lib/module/skia/types`. That module is
plain numbers with no imports of its own, so it loads under `bun test` and in
a browser as readily as a type does, and the enums are only read on the JS
thread, in `createHologramResources`. That is not tidiness; it is the reason
the same drawing runs in four places:

- native Skia, on a phone or a watch;
- CanvasKit, in the browser build published to GitHub Pages;
- CanvasKit headless, in `hologram-drawing.spec.ts` and the contact sheets;
- the headset, which has no React at all.

`main-entry.contract.spec.ts` holds every module directly in `src/` to it, by
parsing them with Bun's own transpiler: an import or re-export not marked as a
type, from anywhere but a sibling or that one Skia module, fails it. A path into
`./react` or `./conversation` counts as outside, since those are other entries.
Mark a type-only import `import type` (or each specifier `type`) even where a
bundler would drop it anyway — the test counts what the source says.

The two ElevenLabs files keep the same rule for the same payoff. `fetch` is a
global rather than an import, so the token request and every failure ElevenLabs
can answer with — a rejected key, a key without permission, an unknown agent, an
account out of credits, a rate limit — are driven in `conversation-token.spec.ts`
with no account, no credential, no SDK and no device.

`hologram-drawing.ts` takes the Skia factory and the canvas as arguments, typed
as `HologramSkia` and `HologramCanvas` — `Pick<>`s of the real types naming only
the calls it makes. Adding a call means widening those picks, which is the point:
the type says exactly how much of Skia the hologram needs.

**`hologram/gpu` keeps the same rule.** It runs in four places too — under `bun
test`, in the headset's browser beside three.js, in a browser beside CanvasKit
and on a phone or a watch beside expo-gl — and imports none of them. The headset
wraps its shader sources in three.js materials (`vr/src/hologram3d/`), and the
raw renderer, `createGpuBody` and `drawGpuBody`, takes the GL context as an
argument typed as `HologramGl`, a `Pick<>` of `WebGL2RenderingContext` naming
the calls it makes, which a browser's context and expo-gl's both fit; the GL
enums are numbers in the module rather than read off the context. Its modules
import the main entry's modules directly (`../hologram-drawing`,
`../frame-timing`), never the `..` barrel, for the reason under "Worklets"
below. `gpu.contract.spec.ts` holds it to both, parsing every module with Bun's
transpiler as the main entry's contract does: a value from anything but a sibling
or one module directly in `src/` fails it, and so do the `..` barrel and the
other entries (`../react`, `../conversation`). Biome reads `gl.useProgram` as a
React hook, so `biome.json` turns `useHookAtTopLevel` off for that folder alone,
where nothing is React.

What runs every frame there is a worklet — `drawGpuBody` and everything it
calls, `placeFlatCamera`, `writeFragmentUniforms` and the view-basis maths — so
an app can draw on whichever thread holds its context. `createGpuBody` is
JS-thread code: it builds the rows, compiles the three programs and uploads about
3 MB of vertices, once, and throws when the context refuses any of it (an ES 2
context cannot compile the GLSL ES 3.00 shaders), which is the app's cue to draw
him without a body. On a phone the body it returns then crosses to the UI thread,
and worklets copy nothing between runtimes but plain objects, arrays and typed
arrays, while expo-gl makes every GL object an instance of a class of its own.
So the body keeps a plain `{ id }` in place of each of expo-gl's, which is all
expo-gl reads of one, and a browser's as they are; `gpu-body.spec.ts` holds it
to that with a context that makes them the way expo-gl does. Nothing deletes
what it made: it goes with the context, and a GL call from the JS thread while
the UI thread draws could race it. The renderer leaves GL state as it set it, so
it needs a context of its own. It draws what the headset draws, pass for pass and in
three's order — the halo union into its own target, then the strokes, then the
halos' light, Screened and faded as one layer — and whether the pixels agree is
a browser's to say: vr's `hologram-gpu-body.spec.ts` draws the same moments both
ways in Chromium, from the matrices three drew with, and fails on one byte
apart. Here, `gpu-body.spec.ts` checks the passes, their targets and their
blending against a context that writes its calls down.

`src/react/` is where React, Reanimated, Skia and expo-gl are called for real,
and it is deliberately thin: a Skia canvas and the GPU body's canvas over it, a
frame callback, the voice read every 40 ms, and the tracker stepped on the UI
thread. It takes a `JarvisVoice` and asks it
two questions — nothing in it knows where the audio came from, so the phone can
hand it a WebRTC track and the watch its own microphone.

The view times how long each frame's JavaScript takes — Skia's picture and the
calls that issue the GPU's frame — which is what the density loop in
`density-control.ts` steers by, with the frame rate as its backstop. The
picture's one loop that runs once a piece, `appendCrescent`, is written out by
hand rather than composed from helpers, because on a device every call between
worklets allocates; `crescent-loop.spec.ts` holds it to a frozen copy of the loop
it replaced, bit for bit, and `biome.json` lets that one file's functions be as
complex as that loop is.

`src/conversation/` is where the ElevenLabs SDK is called for real, and it is
thinner still: `useJarvisSession` hands the main entry's session
`Conversation.startSession`, the greeting's player, the call's audio and a
timer, and holds its snapshot in React. Every rule of the conversation is the
main entry's — see below.

If you find yourself wanting a microphone, a permission prompt, a navigation
decision or a screen layout in any of the four, it belongs in the app, not
here.
