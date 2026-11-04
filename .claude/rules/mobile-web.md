---
paths:
  - "mobile/**"
---

# Web

> Part of [Mobile App](mobile.md). Paths in it are relative to `mobile/` unless they say otherwise.

`platforms` includes `web`, and the conversation genuinely works there: `@elevenlabs/client` resolves through its `browser` export condition to the build that speaks WebRTC through the browser rather than through LiveKit's native modules. The same components and the same session; what differs is decided in `useJarvisSession` by platform (no call audio, dialled behind the greeting) and in the platform pairs below.

These things do differ, and each is a pair of files Metro picks between rather than a conditional:

- **Storage.** `expo-secure-store` ships `export default {}` as its web implementation, so the native path does not degrade on web — it throws. `key-value-store.web.ts` uses `localStorage` instead, and the settings screen says so, because `localStorage` is not a keystore.
- **The microphone.** `PermissionsAndroid` is not part of `react-native-web`. `microphone-permission.web.ts` asks by requesting a stream and releasing it again, so a refusal still surfaces as a permission problem rather than as a failed connection.
- **The camera.** `take-photo.web.ts` is a file picker (`capture="environment"`, which a phone's browser opens on its camera and a desktop's on its files), drawn onto a canvas and re-encoded as the same JPEG the phone sends. A picker only opens inside a tap, which is why the camera button asks for it before anything is awaited, and one left open is taken as closed after the camera app's 110 s.
- **The glance.** `glance-view.web.tsx` is a sandboxed `<iframe>` in place of the phone's WebView, talking to its page by `postMessage`, and `confirm-glance-action.web.ts` asks with `window.confirm` in place of an Android dialog. See [The glance](mobile-the-glance.md).

**Pairing with the Jarvis server stands in for the key and the cookie.** A browser cannot send the
Cloudflare Access service token's headers on a WebSocket, as the phone and the watch do, so the web
build pairs instead, as the headset's page does: **Pair this browser** (`server-pairing.tsx`, on the
settings screen and on the tour's credentials step, in a browser only) sends `hologram`'s
`pairWithServer` through Access's cookie once — if the server did not answer, it offers the
server's sign-in and asks to pair again — and keeps the address and the server's token for the
browser (`loadJarvisDeviceToken` in `jarvis-server.ts`, under `hologram`'s
`JARVIS_DEVICE_TOKEN_STORAGE_KEY`). From then on the server starts every conversation
(`conversation-credentials.ts`: a pairing wins over a saved key, so no ElevenLabs key is needed at
all) and the line opens on `/api/paired/live` with the token. The headset's page keeps its pairing
under the same keys on the same origin, so a browser paired on either is paired on both. Changing or
clearing the server's address forgets the pairing. See "Pairing a device" in
`.claude/rules/mcp-mcp-server-access.md`.

`platform-contracts.ts` holds the types both halves implement, so neither can drift — nothing else in the app imports both.

The hologram is not a pair at all. Both platforms import `JarvisHologram` from `hologram/react`, and in a browser all of him is drawn with WebGL 2 into the one canvas expo-gl's browser `GLView` makes, as a phone draws him with OpenGL ES, so there is nothing to fetch before he can be imported or drawn — not the CanvasKit WebAssembly the browser once had to load, behind a lazily loaded view and an error boundary of its own (`jarvis-hologram.web.tsx`, gone with Skia). A browser without WebGL 2 shows his square empty, and the rest of the screen works as before.

What does **not** work on web is the assistant role, and it never will: it is Android's. The assistant card says that outright instead of offering a setup step that leads nowhere.
