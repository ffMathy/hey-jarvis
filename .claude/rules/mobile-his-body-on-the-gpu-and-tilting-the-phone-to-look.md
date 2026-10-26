---
paths:
  - "mobile/**"
---

# His body on the GPU, and tilting the phone to look round him

> Part of [Mobile App → The hologram](mobile-the-hologram.md). Paths in it are relative to `mobile/` unless they say otherwise.

His body — the thousands of fragments and their halos — is drawn on the GPU, through expo-gl and
`hologram/gpu`, on a canvas Screened over Skia's picture of the rest of him. It is the only body
there is. That is what lets him turn: **tilting the phone looks round him**, up to 25° from a rest
pose that follows how it is held, so a phone held still shows him straight on, and he turns back to
face you while you talk to him (`tilt.ts` in `hologram`). Both screens pass `tilt`, in the sheet and
across the whole screen.

**The app needs Android 10 (API 29).** The two canvases are composed with React Native's
`mixBlendMode`, which does nothing below it, so `app.config.ts` sets `minSdkVersion` 29 the way the
watch's sets 30 (`withPhoneSdkLevel`, a Gradle property, since prebuild regenerates `android/`).
Where the GPU cannot draw him — a development client built without expo-gl, a GPU that gives OpenGL
ES 2, a shader that will not compile — he is drawn without a body, and nothing else changes; a
context lost mid-show takes the body away until expo-gl hands a new one over. "His body on the GPU"
in [`.claude/rules/hologram-his-body-on-the-gpu-on-a-phone-and-a-watch.md`](hologram-his-body-on-the-gpu-on-a-phone-and-a-watch.md) has every case.

The view behind the two canvases paints `SHEET_INK` in the sheet, and the two are Screened onto it as
one group. The sheet still waits for `settled` before he is drawn, so his arrival is not spent
sliding.

None of it has been seen on a phone yet: whether expo-gl's worklet support draws from the UI thread
with this Reanimated, whether Android composes the two canvases in the same frame, what the GPU
costs, and how the tilt feels — its direction, gain and dead band. The web build in Chromium is
where it has been looked at (`hologram-body.spec.ts`, under "The browser tests").

What can be read without a phone has been, from an Android bundle exported unminified and without
bytecode (`bunx expo export -p android --no-bytecode --no-minify`): `drawGpuBody`,
`placeFlatCamera`, `writeFragmentUniforms`, `advanceTilt`, `tiltFront` and the view's frame
callback all come out as worklets — init data, a hash and a `__closure` — and walking every closure
down from them finds only worklets, numbers (the GL enums among them), typed arrays and plain
objects, shared values, and expo-gl's own `getWorkletContext`, never a function left uncompiled.
`expo-modules-autolinking resolve --platform android` links `ExpoGL` (`expo.modules.gl.GLModule`,
Expo's prebuilt library) in both apps. The watch's bundle compiles the same way.
