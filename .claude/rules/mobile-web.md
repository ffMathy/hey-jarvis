---
paths:
  - "mobile/**"
---

# Web

> Part of [Mobile App](mobile.md). Paths in it are relative to `mobile/` unless they say otherwise.

`platforms` includes `web`, and the conversation genuinely works there: `@elevenlabs/client` resolves through its `browser` export condition to the build that speaks WebRTC through the browser rather than through LiveKit's native modules. The same components and the same session; what differs is decided in `useJarvisSession` by platform (no call audio, dialled behind the greeting) and in the platform pairs below.

These things do differ, and each is a pair of files Metro picks between rather than a conditional:

- **Storage.** `expo-secure-store` ships `export default {}` as its web implementation, so the native path does not degrade on web — it throws. `key-value-store.web.ts` uses `localStorage` instead, and the settings screen says so, because `localStorage` is not a keystore.
- **Pairing.** `pair-with-server.web.ts` sends the pairing request itself, through Access's cookie; `pair-with-server.ts` opens the server's pairing page in the phone's browser and waits for the app's own link. See below.
- **The microphone.** `PermissionsAndroid` is not part of `react-native-web`. `microphone-permission.web.ts` asks by requesting a stream and releasing it again, so a refusal still surfaces as a permission problem rather than as a failed connection.
- **The camera.** `take-photo.web.ts` is a file picker (`capture="environment"`, which a phone's browser opens on its camera and a desktop's on its files), drawn onto a canvas and re-encoded as the same JPEG the phone sends. A picker only opens inside a tap, which is why the camera button asks for it before anything is awaited, and one left open is taken as closed after the camera app's 110 s.
- **The glance.** `glance-view.web.tsx` is a sandboxed `<iframe>` in place of the phone's WebView, talking to its page by `postMessage`, and `confirm-glance-action.web.ts` asks with `window.confirm` in place of an Android dialog. See [The glance](mobile-the-glance.md).

**The browser pairs itself, through Access's cookie.** Pairing is the only way to set Jarvis up
(see [Configuration](mobile-configuration.md#configuration)), and a browser does it the way the
headset's page does: **Pair this browser with your server** (`server-pairing.tsx`, on the settings
screen and on the tour's server step, through `pair-with-server.web.ts`) sends `hologram`'s
`pairWithServer` — a plain-text `POST <server>/api/devices` naming it "Phone web app", with the
browser's cookies and no preflight, which would carry none — once. If the server did not answer, it
offers the server's sign-in (`serverSignInUrl`) and asks to pair again. The address and the
server's token are kept for the browser under `hologram`'s `jarvis.server-address` and
`JARVIS_DEVICE_TOKEN_STORAGE_KEY`, in `localStorage`, which the screen says is not a keystore. From
then on the server starts every conversation and the line opens on `/api/paired/live` with the token.
The headset's page keeps its pairing under the same keys on the same origin, so a browser paired on
either is paired on both. Pairing with another address, or **Forget this server**, forgets the
pairing. The phone app cannot pair this way — it holds no cookie — and opens the server's pairing
page in the browser instead. See "Pairing a device" in `.claude/rules/mcp-mcp-server-access.md`.

`platform-contracts.ts` holds the types both halves implement, so neither can drift — nothing else in the app imports both.

The hologram is not a pair at all. Both platforms import `JarvisHologram` from `hologram/react`, and in a browser all of him is drawn with WebGL 2 into the one canvas expo-gl's browser `GLView` makes, as a phone draws him with OpenGL ES, so there is nothing to fetch before he can be imported or drawn — not the CanvasKit WebAssembly the browser once had to load, behind a lazily loaded view and an error boundary of its own (`jarvis-hologram.web.tsx`, gone with Skia). A browser without WebGL 2 shows his square empty, and the rest of the screen works as before.

What does **not** work on web is the assistant role, and it never will: it is Android's. The assistant card says that outright instead of offering a setup step that leads nowhere.
