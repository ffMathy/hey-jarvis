---
paths:
  - "mobile/**"
---

# His body on the GPU, and tilting the phone to look round him

> Part of [Mobile App → The hologram](mobile-the-hologram.md). Paths in it are relative to `mobile/` unless they say otherwise.

All of him is drawn on the GPU, through expo-gl and `hologram/gpu`, into one canvas: his body — the
thousands of fragments and their halos — and the rest of him, the whorl, the core, the rim and the
satellites, which Skia used to draw beside it. There is nothing else to draw him with. The body in
three dimensions is what lets him turn: **tilting the phone looks round him**, up to 25° from a rest
pose that follows how it is held, so a phone held still shows him straight on, and he turns back to
face you while you talk to him (`tilt.ts` in `hologram`). Both screens pass `tilt`, in the sheet and
across the whole screen.

**The app needs Android 10 (API 29).** His canvas is Screened onto the sheet behind him with React
Native's `mixBlendMode`, which does nothing below it, so `app.config.ts` sets `minSdkVersion` 29 the
way the watch's sets 30 (`withPhoneSdkLevel`, a Gradle property, since prebuild regenerates
`android/`). Where the GPU cannot draw him — a development client built without expo-gl, a GPU that
gives OpenGL ES 2, a shader that will not compile — he is not drawn at all: his square stays empty
and the rest of the screen, the conversation included, goes on. A context lost mid-show takes him
away until expo-gl hands a new one over. "His body on the GPU"
in [`.claude/rules/hologram-his-body-on-the-gpu-on-a-phone-and-a-watch.md`](hologram-his-body-on-the-gpu-on-a-phone-and-a-watch.md) has every case.

The view behind the canvas paints `SHEET_INK` in the sheet, and the canvas is Screened onto it. The sheet still waits for `settled` before he is drawn, so his arrival is not spent
sliding.

None of it has been seen on a phone yet: whether expo-gl's worklet support draws from the UI thread
with this Reanimated, what the GPU costs, and how the tilt feels — its direction, gain and dead band. The web build in Chromium is
where it has been looked at (`hologram-canvas.spec.ts`, under "The browser tests").

What can be read without a phone has been, from an Android bundle exported unminified and without
bytecode (`bunx expo export -p android --no-bytecode --no-minify`): `drawGpuBody`,
`placeFlatCamera`, `writeFragmentUniforms`, `advanceTilt`, `tiltFront` and the view's frame
callback all come out as worklets — init data, a hash and a `__closure` — and walking every closure
down from them finds only worklets, numbers (the GL enums among them), typed arrays and plain
objects, shared values, and expo-gl's own `getWorkletContext`, never a function left uncompiled.
`expo-modules-autolinking resolve --platform android` links `ExpoGL` (`expo.modules.gl.GLModule`,
Expo's prebuilt library) in both apps. The watch's bundle compiles the same way.
