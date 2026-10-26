---
paths:
  - "vr/**"
---

# The honest limits

> Part of [VR](vr.md). Paths in it are relative to `vr/` unless they say otherwise.

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
- **Pages shows the last release** at the root, not the latest push; each pull
  request has its own preview under `pr/<n>/` (see "Publishing" below).
- **No service worker.** The wasm in `vendor/` and the models are not
  content-hashed, so a cache-first worker would serve an old
  `ort-wasm-simd-threaded.wasm` to a newer onnxruntime-web after a dependency update, and a network-first one would
  buy only an offline start, which a conversation over the network cannot use.
  Add one when there is a way to version its cache with the build. There is a web
  manifest and an icon.
