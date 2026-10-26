---
paths:
  - "mobile/**"
---

# Dependencies

> Part of [Mobile App](mobile.md). Paths in it are relative to `mobile/` unless they say otherwise.

Versions are pinned exactly, and every one of them has to clear the repository's 7-day npm cooldown (see [Supply Chain Security](supply-chain-security.md)). Three pins are not just "the latest that fits":

- `@livekit/react-native` is held at **2.x**. The 3.x line is published as `latest` but does not satisfy `@elevenlabs/react-native`'s peer range.
- `livekit-client` is a direct dependency even though it is transitive, so only one copy can resolve.
- `expo-audio` is at **57.0.5**, what Expo 57's `bundledNativeModules.json` allows (`~57.0.4`). It plays the greeting in a browser, through an `HTMLAudioElement`; on Android `hologram`'s own native module plays it, as call audio. It needs no config plugin: it only plays, and its manifest adds nothing but `MODIFY_AUDIO_SETTINGS`.
- `@config-plugins/react-native-webrtc` is deliberately **not** installed. Its Android half only adds permissions, and two of them — `CAMERA` and `SYSTEM_ALERT_WINDOW` — have no business in a voice assistant. `app.config.ts` declares the permissions this app actually uses and blocks `CAMERA`, which LiveKit's own manifest would otherwise merge in. The block is also what lets the phone's camera app take a photo for Jarvis with no permission at all — see "Showing him something".
- **No camera package either.** expo-camera and expo-image-picker both need the current activity, which the assistant's window does not have; the photo is taken by the phone's own camera app through a small activity in `modules/jarvis-assistant`, and read back with React Native's own `fetch`.

`metro.config.js` points Metro at both this package's `node_modules` and the workspace root's, and keeps hierarchical lookup **on** — the usual monorepo advice to switch it off breaks bun's isolated layout, where walking up from the importing file is how a package finds its own dependencies.

It deliberately does **not** pin `react`, `react-native`, `livekit-client` and the LiveKit packages to one copy each, which is the other half of that advice. Bun's store is keyed by version and dependency closure, so it can hold a package twice — 19 of them do here — but none of those five, and bundling with and without the resolver gives the same hash and the same module count. The comment in the file says what the symptom would be if a bump ever splits one of them, and asks you to measure before adding it back.

The hologram adds three native packages, each at the version Expo 57 pins in `bundledNativeModules.json`: `react-native-reanimated` 4.5.1, `react-native-worklets` 0.10.1 and `expo-gl` 57.0.2. expo-gl draws all of him on the GPU; its Android half is Expo's prebuilt library, about 0.8 MB of arm64 code, and the view loads it only once `requireOptionalNativeModule('ExpoGL')` finds it, so a development client built before it was added shows an empty square where he would be rather than failing to load.

**There is no Skia, and no setup step.** `@shopify/react-native-skia` drew everything but his body until all of him moved to the GPU, and it was the one package here that needed anything done after `bun install`: its prebuilt native libraries, and `canvaskit.wasm` for the web, came from its own postinstall, which never runs here, so `turbo initialize` copied them in — through a root task (`//#install-skia`), since the phone and the watch shared one copy of the package and two apps rewriting its `libs/` at once broke the release `deploy` job twice. With Skia gone, so are that task, `.scripts/install-skia.sh`, this package's `initialize` and its `canvaskit.wasm`: nothing is fetched before he can be drawn in a browser, and an Android build needs nothing put in place first.

One pin is easy to trip over:

- **`@babel/core` is pinned to 7.29.7 as a dev dependency.** Worklets' Babel plugin compiles each worklet by calling `@babel/core` itself, and declares it as a peer with any version. Left alone, bun satisfied that peer with the Babel 8 that `mastra`'s deployer brings into the workspace, and the release bundle failed with `Requires Babel "^7.0.0-0", but was loaded with "8.0.1"`. The pin gives this package the Babel its Expo preset uses; `mastra` keeps its own 8.

`eas.json` pins bun to `1.3.14` in a `base` profile the three real profiles extend. Without it an EAS build uses whatever bun its image happens to ship, while the repository pins `packageManager` and `engines.bun` — so keep the three in step. It has to be an exact version; the schema validates it with `semver.valid`, which rejects a range.
