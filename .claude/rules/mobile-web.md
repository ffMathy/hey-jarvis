---
paths:
  - "mobile/**"
---

# Web

> Part of [Mobile App](mobile.md). Paths in it are relative to `mobile/` unless they say otherwise.

`platforms` includes `web`, and the conversation genuinely works there: `@elevenlabs/client` resolves through its `browser` export condition to the build that speaks WebRTC through the browser rather than through LiveKit's native modules. The same components and the same session; what differs is decided in `useJarvisSession` by platform (no call audio, dialled behind the greeting) and in the platform pairs below.

Three things do differ, and each is a pair of files Metro picks between rather than a conditional:

- **Storage.** `expo-secure-store` ships `export default {}` as its web implementation, so the native path does not degrade on web — it throws. `key-value-store.web.ts` uses `localStorage` instead, and the settings screen says so, because `localStorage` is not a keystore.
- **The microphone.** `PermissionsAndroid` is not part of `react-native-web`. `microphone-permission.web.ts` asks by requesting a stream and releasing it again, so a refusal still surfaces as a permission problem rather than as a failed connection.
- **The camera.** `take-photo.web.ts` is a file picker (`capture="environment"`, which a phone's browser opens on its camera and a desktop's on its files), drawn onto a canvas and re-encoded as the same JPEG the phone sends. A picker only opens inside a tap, which is why the camera button asks for it before anything is awaited, and one left open is taken as closed after the camera app's 110 s.

`platform-contracts.ts` holds the types both halves implement, so neither can drift — nothing else in the app imports both.

The hologram is the fourth pair, and a different kind: Skia's web build is WebAssembly that has to be fetched before anything Skia-backed can even be imported. `jarvis-hologram.web.tsx` loads the view lazily through `WithSkiaWeb`, holding its space empty meanwhile, and CanvasKit is served from the site root — `turbo initialize` copies `canvaskit.wasm` into `public/`, which the web export publishes — so a browser never reaches for a CDN. His body is drawn with WebGL 2, on a second canvas Screened over CanvasKit's with CSS `mix-blend-mode`; a browser without WebGL 2 shows the rest of him without a body.

What does **not** work on web is the assistant role, and it never will: it is Android's. The assistant card says that outright instead of offering a setup step that leads nowhere.
