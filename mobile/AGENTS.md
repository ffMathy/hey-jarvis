# Mobile App

> **Note:** See the root [AGENTS.md](../AGENTS.md) for shared conventions (Turborepo commands, commit standards, 1Password, etc.)

## Overview

An Expo app that registers as the phone's **default digital assistant** on Android, replacing Gemini or Google Assistant, and answers as Jarvis over a live ElevenLabs voice conversation. It also builds for web, where the conversation works and the assistant role does not.

No iOS target: Apple does not let an app replace Siri, so it would ship something that cannot do the one thing this project exists for.

## TURBO Commands

```bash
bunx turbo lint --filter=mobile       # Biome
bunx turbo typecheck --filter=mobile  # tsgo
bunx turbo test --filter=mobile       # the offline suite
bunx turbo build --filter=mobile      # bundles the JS for Android into dist/mobile
bunx turbo build:apk --filter=mobile  # installable arm64 release APK into dist/mobile-apk (needs JDK + Android SDK)
bunx turbo e2e --filter=mobile        # exports for web and drives it in Chromium
```

## Getting an APK onto a phone

The **Mobile APK** workflow (`.github/workflows/mobile-apk.yml`) builds one on every push to `main` and every pull request that touches the app — `mobile/**`, the lockfile, or the build configuration — and can be started by hand from the Actions tab. Open the run and download `jarvis-<commit>.apk` from its Artifacts; it is uploaded unzipped, so it is the APK itself. Artifacts are kept for 30 days.

It runs `build:apk` straight on the runner rather than in the dev container CI uses, because the runner image already has the Android SDK with its licences accepted. Three things about the APK worth knowing:

- **arm64-v8a only.** That is what phones run, and each extra ABI compiles every native module again. For an x86_64 emulator, build locally with `reactNativeArchitectures=x86_64`, or use `.scripts/verify-assistant-on-emulator.sh`, which does.
- **Signed with the Expo template's debug keystore**, the same well-known key everywhere. CI and local builds therefore install over each other, which is what side-loading wants — but anyone can sign an update with that key, so it is not a distribution build. Anything published goes through EAS (`eas.json`'s `production` profile) with a real key.
- **It is the release variant**: the JS bundle is embedded, no Metro and no development client, and nothing configured — the ElevenLabs API key and agent ID are typed into the settings screen on first run, as on any install.

To run it on a device (needs the Android SDK, which CI does not have):

```bash
bun run --cwd mobile native:prebuild   # generates android/ from app.config.ts + modules/
bun run --cwd mobile android           # builds and installs a development build
bun run --cwd mobile start             # Metro, for an already-installed development build
```

The prebuild script is called `native:prebuild` rather than `prebuild` deliberately: npm and bun treat `prebuild` as a lifecycle hook and run it automatically before `build`, which would put `expo prebuild` in front of every CI build — needing an Android SDK that CI does not have.

**Expo Go does not work.** The conversation needs LiveKit's native WebRTC modules and the assistant registration needs the native module in `modules/`, so a development build is the minimum.

## How it fits together

```
phone (assist gesture)
  └─ JarvisVoiceInteractionSession          modules/jarvis-assistant (Kotlin)
       └─ heyjarvis://assist                deep link into the app
            └─ ConversationScreen           src/conversation-screen.tsx
                 ├─ GET /v1/convai/conversation/token   → ElevenLabs, with the API key
                 └─ WebRTC session                      → the ElevenLabs Jarvis agent
```

The agent on the other end is the same one `elevenlabs/` deploys, with the same prompt and the same `routePromptWorkflow` tools. This app adds a way to reach it, not a second Jarvis.

## File Structure

```
mobile/
├── app.config.ts                 # Expo config: package name, scheme, permissions, plugins
├── index.ts                      # registerRootComponent
├── metro.config.js               # monorepo resolution + singleton pinning
├── eas.json                      # development / preview / production builds
├── modules/jarvis-assistant/     # the local Expo module that owns the assistant registration
│   ├── index.ts                  # the JS side
│   └── android/src/main/         # Kotlin, the merged manifest, and res/xml
└── src/
    ├── app.tsx                   # root component and the two screens
    ├── conversation-screen.tsx   # the hologram, the Talk button and the assistant card
    ├── jarvis-hologram.tsx       # the hologram on Android …
    ├── jarvis-hologram.web.tsx   # … and in a browser, once CanvasKit has loaded
    ├── jarvis-hologram-view.tsx  # Skia canvas, Reanimated clocks, reading the voice
    ├── hologram-drawing.ts       # what one frame of the hologram looks like (worklets)
    ├── jarvis-voice.ts           # Jarvis's voice as the SDK measures it
    ├── voice-levels.ts           # spectrum folding and easing, frame-rate independent
    ├── settings-screen.tsx
    ├── assist-link.ts            # what "opened by the assistant" looks like
    ├── conversation-token.ts     # minting a conversation token from ElevenLabs
    ├── elevenlabs-settings.ts    # validation of what the user typed
    ├── settings-storage.ts       # platform-agnostic half of persistence
    ├── platform-contracts.ts     # the shapes the .web.ts pairs below must keep
    ├── key-value-store.ts        # keystore on Android …
    ├── key-value-store.web.ts    # … localStorage in a browser
    ├── microphone-permission.ts      # PermissionsAndroid …
    └── microphone-permission.web.ts  # … getUserMedia
```

## The hologram

The conversation screen is built around Jarvis as the films drew him: a golden, see-through sphere of broken arcs, specks, glass panels and struts around a knotted core, turning slowly on its own and swelling with his voice.

```
@elevenlabs/react-native  getOutputVolume / getOutputByteFrequencyData   (native LiveKit processors, ~25 Hz)
  └─ jarvis-voice.ts      read every 40 ms on the JS thread
       └─ voice-levels.ts perceivedLevel + foldSpectrum → 24 log-spaced bands (targets)
            └─ jarvis-hologram-view.tsx   UI thread, every frame: easeLevel/easeBands toward the targets
                 └─ hologram-drawing.ts   drawHologram(canvas, size, frame, scene, resources) → Skia Picture
```

What the voice does to it, and why each layer is where it is, is written at the top of `hologram-drawing.ts`. Three things are worth knowing before changing it:

- **It is all worklets.** `drawHologram` and every helper it calls start with `'worklet'` and use only their arguments, because the picture is recorded on the UI thread. The scene (plain numbers, built once from a fixed seed) and the resources (paints, shaders and mutable `PathBuilder`s, built once) are created per mounted canvas and must never be shared between two.
- **Loudness is eased on the UI thread, not the JS thread.** The SDK refreshes about 25 times a second; easing toward each reading every frame is what keeps the pulse smooth, and `easeLevel` is exponential so the pulse is the same on a 60 Hz and a 120 Hz screen.
- **It was designed by looking, and is tested by looking.** `hologram-drawing.spec.ts` renders it headlessly through CanvasKit — the same Skia API calls — and asserts on pixels: it moves when silent, loud speech is clearly brighter than silence, which bands are sounding changes the picture, and it stays inside its square. The device check is `.scripts/verify-hologram-on-emulator.sh`, below.

## Configuration

The app ships with no credential. It talks to ElevenLabs directly, and both settings are typed into the settings screen on first run and kept in the Android keystore — or, on web, in `localStorage`:

| Setting | What it is |
| --- | --- |
| API key | An ElevenLabs API key, sent as `xi-api-key` to ElevenLabs and nowhere else |
| Agent ID | The Jarvis agent — the value of `HEY_JARVIS_ELEVENLABS_AGENT_ID` |

For each conversation the app asks `GET https://api.elevenlabs.io/v1/convai/conversation/token` for a WebRTC token for that agent, and the session runs on the token; the key itself is used for nothing else. `conversation-token.ts` turns each failure into what to fix — a rejected key, a key without permission to start conversations (which ElevenLabs can also answer with 401), an agent ID the account does not have or a malformed one (400), an account out of credits (402), rate limiting (429) — by reading only ElevenLabs' fixed `detail.status` / `detail.code` identifiers. It never repeats anything else from a response, since a message can echo the request that carried the key.

This used to go through the MCP server, which held the key and handed the phone tokens behind a shared secret. It was changed so the app needs nothing but ElevenLabs: no server address, no second secret, no tunnel to reach. The price is a real credential on the phone, so give the app **its own key**, restricted to what a conversation needs where the account allows it — then a lost phone is one revoked key, not every integration on the account.

What the keystore does and does not do for that key:

- **It keeps it from other apps.** `expo-secure-store` encrypts the entry with a key held in the Android Keystore, which only this app's user ID can use.
- **It keeps it out of backups.** The `expo-secure-store` config plugin in `app.config.ts` adds backup and data-extraction rules that leave its storage out of Google's cloud backup and device-to-device transfer. (After a restore the entry would not decrypt anyway, since the keystore key never leaves the phone; the app then simply opens on the settings screen.)
- **It does not protect it from an update of this app — and the side-loaded APK makes that easy.** Anything installed as an update of `com.ffmathy.heyjarvis` runs as the same app and can read the key. Android only accepts an update signed with the same key, but the APK the Mobile APK workflow builds is signed with the Expo template's public debug key (see "Getting an APK onto a phone"), so *any* APK signed with that key qualifies — including the workflow's own builds of pull requests. Never install a pull request's APK over an install that holds your real key. Closing this properly means signing with a private release key kept in a CI secret that pull request builds cannot reach.
- **It is not autofill's.** Both settings fields opt out of autofill and password managers, so saving them does not copy the key into a synced vault.

Reading the key can also fail outright — a keystore key invalidated by an OS update, say — and that reads as "nothing stored": the app opens on the settings screen rather than hanging on its loading spinner.

## Becoming the assistant

Registration is entirely declarative, and every piece of it is load-bearing. `modules/jarvis-assistant/android/src/main/AndroidManifest.xml` is a *library* manifest that the Android build merges into the app's own, which is why there is no config plugin for any of this.

What has to be true, or the app silently never appears in the picker:

- The `VoiceInteractionService` is `exported="true"` and requires `android.permission.BIND_VOICE_INTERACTION`. The system process binds it across UIDs; `exported="false"` fails the bind with nothing logged in the app.
- The same goes for the session service.
- `res/xml/jarvis_voice_interaction_service.xml` names **both** a `sessionService` and a `recognitionService`. A missing `recognitionService` is still a hard parse error on current Android, and on API 29–30 the named class is copied into the device-wide speech recogniser setting — so `JarvisRecognitionService` has to exist and be instantiable even though it recognises nothing.
- `supportsAssist="true"` produces no error when missing and quietly downgrades the app to the plain assist-intent path.

Two things Android does **not** allow, both of which look like they work in code:

- `RoleManager.createRequestRoleIntent(ROLE_ASSISTANT)` shows no dialog. The role is declared not requestable, so the activity finishes immediately. The app sends the user to `Settings.ACTION_VOICE_INPUT_SETTINGS` instead, and re-reads the role when it comes back to the foreground.
- Calling `hide()` before `startAssistantActivity()` makes the start illegal: what it checks is that the session is currently shown, and `hide()` retracts it. Start the activity first, hide second. Suppressing the session's own window with `setUiEnabled(false)` in `onPrepareShow` is fine and is what AOSP recommends for a session that only launches an activity — it is a client-side flag and does not make the session un-shown — but nothing may ask for a content view afterwards.

To debug a device where Jarvis does not appear in the picker:

```bash
adb logcat -s VoiceInteractionServiceInfo   # names the exact parse error
adb shell cmd role get-role-holders android.app.role.ASSISTANT
```

## Dependencies

Versions are pinned exactly, and every one of them has to clear the repository's 7-day npm cooldown (see the root AGENTS.md). Three pins are not just "the latest that fits":

- `@livekit/react-native` is held at **2.x**. The 3.x line is published as `latest` but does not satisfy `@elevenlabs/react-native`'s peer range.
- `livekit-client` is a direct dependency even though it is transitive, so only one copy can resolve.
- `@config-plugins/react-native-webrtc` is deliberately **not** installed. Its Android half only adds permissions, and two of them — `CAMERA` and `SYSTEM_ALERT_WINDOW` — have no business in a voice assistant. `app.config.ts` declares the permissions this app actually uses and blocks `CAMERA`, which LiveKit's own manifest would otherwise merge in.

`metro.config.js` points Metro at both this package's `node_modules` and the workspace root's, and keeps hierarchical lookup **on** — the usual monorepo advice to switch it off breaks bun's isolated layout, where walking up from the importing file is how a package finds its own dependencies.

It deliberately does **not** pin `react`, `react-native`, `livekit-client` and the LiveKit packages to one copy each, which is the other half of that advice. Bun's store is keyed by version and dependency closure, so it can hold a package twice — 19 of them do here — but none of those five, and bundling with and without the resolver gives the same hash and the same module count. The comment in the file says what the symptom would be if a bump ever splits one of them, and asks you to measure before adding it back.

The hologram adds three native packages, each at the version Expo 57 pins in `bundledNativeModules.json`: `@shopify/react-native-skia` 2.6.2, `react-native-reanimated` 4.5.1 and `react-native-worklets` 0.10.1. Two consequences that are easy to trip over:

- **`turbo initialize` has to have run.** Skia gets its prebuilt native libraries, and `canvaskit.wasm` for the web, from its own postinstall — which never runs here. `.scripts/initialize.sh` does those two copies instead (nothing is downloaded), and `build:apk` and `e2e` depend on it. Without it an Android build fails in CMake and the web hologram cannot load.
- **`@babel/core` is pinned to 7.29.7 as a dev dependency.** Worklets' Babel plugin compiles each worklet by calling `@babel/core` itself, and declares it as a peer with any version. Left alone, bun satisfied that peer with the Babel 8 that `mastra`'s deployer brings into the workspace, and the release bundle failed with `Requires Babel "^7.0.0-0", but was loaded with "8.0.1"`. The pin gives this package the Babel its Expo preset uses; `mastra` keeps its own 8.

`eas.json` pins bun to `1.3.14` in a `base` profile the three real profiles extend. Without it an EAS build uses whatever bun its image happens to ship, while the repository pins `packageManager` and `engines.bun` — so keep the three in step. It has to be an exact version; the schema validates it with `semver.valid`, which rejects a range.

## Web

`platforms` includes `web`, and the conversation genuinely works there: `@elevenlabs/react-native` resolves through its `browser` export condition to the plain `@elevenlabs/react` build, which speaks WebRTC through the browser rather than through LiveKit's native modules. The same components, the same provider, no branching in the screens.

Two things do differ, and each is a pair of files Metro picks between rather than a conditional:

- **Storage.** `expo-secure-store` ships `export default {}` as its web implementation, so the native path does not degrade on web — it throws. `key-value-store.web.ts` uses `localStorage` instead, and the settings screen says so, because `localStorage` is not a keystore.
- **The microphone.** `PermissionsAndroid` is not part of `react-native-web`. `microphone-permission.web.ts` asks by requesting a stream and releasing it again, so a refusal still surfaces as a permission problem rather than as a failed connection.

`platform-contracts.ts` holds the types both halves implement, so neither can drift — nothing else in the app imports both.

The hologram is the third pair, and a different kind: Skia's web build is WebAssembly that has to be fetched before anything Skia-backed can even be imported. `jarvis-hologram.web.tsx` loads the view lazily through `WithSkiaWeb`, holding its space empty meanwhile, and CanvasKit is served from the site root — `turbo initialize` copies `canvaskit.wasm` into `public/`, which the web export publishes — so a browser never reaches for a CDN.

What does **not** work on web is the assistant role, and it never will: it is Android's. The assistant card says that outright instead of offering a setup step that leads nowhere.

## Testing

Everything under `src/` that can be tested without a device is, and it runs in the ordinary offline suite:

```bash
bunx turbo test --filter=mobile
```

Tests must not import React Native or any Expo native module — there is no runtime for them under `bun test`. Keep logic worth testing in plain `.ts` files (`assist-link.ts`, `elevenlabs-settings.ts`, `conversation-token.ts`) and let the `.tsx` files stay thin enough to read.

`turbo build` bundles the JavaScript with Metro rather than assembling an APK. That needs no Android SDK, so it runs in CI's dev container on every push, and it still catches the failures a bundle can catch: an import that does not resolve, a native module missing from the tree, a file no test imports. The native build — Kotlin, Gradle, the manifest merge — is exercised by the Mobile APK workflow, only when the app changes.

### The browser tests

`turbo e2e --filter=mobile` exports the production web build and drives it in Chromium — the real bundle, served over HTTP, clicked through. It runs in CI alongside the rest.

The boundary is the ElevenLabs session, which needs a real API key and real quota. Everything up to it is exercised for real: settings validation, persistence across a reload, the assistant card's web state, the hologram drawing and moving with CanvasKit loaded from the export's own `canvaskit.wasm`, and the token request to ElevenLabs — its `xi-api-key` header, agent ID and participant name, and that the key never appears in the URL — along with how a rejected key and an unknown agent are explained. The token URL is intercepted with `page.route`; every other non-localhost request is aborted, and non-local WebSockets are closed, so a test can never dial out. Playwright answers CORS preflights for routed requests itself, so whether ElevenLabs' real CORS policy admits the web build is **not** covered — the test checks instead that the request carries no header besides `xi-api-key`, which is all a preflight would have to allow.

Set `CHROMIUM_EXECUTABLE_PATH` to run against a Chromium that Playwright did not install itself — useful in a sandbox that ships a browser of a different build than the pinned `@playwright/test` expects. Leave it unset everywhere else.

### What CI cannot test, and what stands in for it

CI has no Android emulator, and neither does an agent sandbox: that needs the Android SDK and hardware virtualisation, and the SDK only comes from `dl.google.com`. So the device-level behaviour — the assist gesture, the role picker, the session opening the app — is checked by hand on an emulator, with the script below, rather than on every push. The commands above under "Becoming the assistant" are how to look at it there, and this is the one-line version:

```bash
adb shell cmd role get-role-holders android.app.role.ASSISTANT  # is Jarvis the assistant?
adb shell settings get secure voice_interaction_service          # "" means the degraded path
adb shell input keyevent 219                                     # KEYCODE_ASSIST — the button
adb shell am start -a android.intent.action.ASSIST               # the activity path instead
adb logcat -s JarvisAssistant VoiceInteractionServiceInfo        # what the session logged
```

`keyevent 219` is the one that matters: it goes through the same path as the real button, so it reaches `JarvisVoiceInteractionSession.onShow` rather than the `ASSIST` activity, and is the only way to exercise `startAssistantActivity` short of holding the hardware button.

A GitHub-hosted runner *does* have KVM, so an emulator job is possible in principle — but adding one means a new `uses:` entry, and every action here is pinned through `.github/workflows/actions.lock`. Regenerate it with `gh actions-lock` in the same change, or GitHub rejects every workflow in the repository.

`.scripts/verify-assistant-on-emulator.sh` encodes the whole check so it is run the same way each time instead of being reconstructed from memory: boot a headless AVD, build and install the release variant, grant the role from the shell, put the launcher in front, press `KEYCODE_ASSIST`, and assert three things — Jarvis is the resumed activity, its task is `type=assistant` (which only `startAssistantActivity` produces; the session's plain-`startActivity` fallback would also bring Jarvis up, in a `standard` task), and the system logged a start of `heyjarvis://assist`. It checks every prerequisite before touching anything and names what is missing.

**It passes.** Run on 2026-09-14/15 on WSL2 (Ubuntu 22.04, 8 cores, 16 GB, KVM) against a freshly created AVD — `system-images;android-34;google_apis;x86_64` revision 14, Pixel 6 profile, emulator 37.1.11 — it exits 0 with the role held, `voice_interaction_service` pointing at `JarvisVoiceInteractionService`, and Jarvis resumed in an assistant task started by uid 1000 from the session. The first end-to-end runs failed, and each failure is now handled and commented in the script rather than left for the next person:

- `expo run:android` on the default debug variant stays attached to Metro and never returns; it is a release build with `--no-bundler` instead.
- Installing launches the app, so Jarvis was already in front before the button was pressed — the original assertion could not fail. The launcher has to hold the front first.
- The headless display sleeps and the keyguard returns; both swallow `KEYCODE_ASSIST`. The screen is kept on and the lock screen disabled.
- On a fresh AVD, `cmd role add-role-holder` throws `TimeoutException` for close to three minutes after boot while PermissionController re-evaluates every default role. The grant is retried against a deadline.
- First boot on a loaded machine leaves a SystemUI "not responding" dialog in focus indefinitely; key presses into it kill SystemUI and bring the keyguard back. The dialog is cleared first, and the build's idle Gradle and Kotlin daemons (~5 GB) are stopped so the emulator is not starved into it.

The last run, against a fresh AVD with a warm Gradle cache, took 4½ minutes end to end; earlier ones on the same machine took closer to ten while other work competed for memory, most of it first boot and waiting out the role controller. The very first build on a machine adds twenty.

What the script does **not** cover is whether the conversation then starts on its own, because that needs a real session. It was checked by hand on the same emulator, pointing the app (then still configured with a server address) at a local listener that logged one line per token request — one line per `start()`. That found a real bug: only the first summoning after the app process started opened the microphone, and every later one brought Jarvis to the front and waited for a tap (`0, 0, 0` requests for three summonings; `1` for tapping Talk). The system keeps an assistant's process alive while it holds the role, so on a phone that is almost every summoning. It is fixed — each summoning now carries a `summon` value that differs every time, and the screen claims each URL once per process (`createAssistLaunchClaim` in `assist-link.ts`) — and the same measurement then gave one request for every summoning. One summoning out of fourteen after the fix produced no request, immediately after a reinstall, and did not happen again in thirteen further attempts, including ones that recreated those conditions; its log had already been cleared, so its cause is unknown.

Two things the emulator showed about the role itself, both Android's behaviour rather than the app's: **Force stop** and **Clear storage** on Jarvis's App info screen each hand the assistant role straight back to the default — `VoiceInteractionManager` logs `Force stopping current voice interactor` and clears the role holder. An app update and ordinary process death keep it. So a user who force-stops Jarvis has to pick it again in Settings, and the assistant card will say so when the app next comes to the foreground.

What guards the handover in the meantime is `src/assist-link.contract.spec.ts`: it reads the URL out of `AssistLauncher.kt`, the `scheme` out of `app.config.ts` and `ASSIST_URL` out of `assist-link.ts`, and fails if they disagree. That drift is silent otherwise — the build passes, the app installs, the registration stays valid, and the gesture opens an app that waits to be asked again.

Two things that would otherwise ride on reasoning alone have been checked another way, and are worth re-checking the same way if the manifest or the Kotlin changes:

- The Kotlin compiles against a real `android.jar`, which is what catches a misused framework API.
- The library manifest merges as intended. Running AGP's own `ManifestMerger2` over the generated app manifest plus this module's and LiveKit's, with `REMOVE_TOOLS_DECLARATIONS` on, puts all four components in the output with `exported="true"` and `BIND_VOICE_INTERACTION` intact, and confirms `blockedPermissions` really does drop LiveKit's `CAMERA`.

### The hologram on a device

`.scripts/verify-hologram-on-emulator.sh` checks what the headless spec cannot: that the hologram animates inside the real app, through Reanimated and native Skia, and pulses with a voice. There is no ElevenLabs session on an emulator, so it builds the release app with `JARVIS_VOICE_REPLAY=1`, which makes Metro swap `jarvis-voice.ts` for `tests/hologram-preview/jarvis-voice.replay.ts`. That replays an espeak-ng line as RMS volume and a 1024-bin spectrum every 40 ms — the spectrum as Web Audio's `AnalyserNode` reports it, which is what the ElevenLabs web SDK hands over — looping six seconds of silence and then the line. The script fills in placeholder settings, records the screen for 180 s, and has `measure-pulse.ts` compare the hologram's brightness in each frame with the level the app should have been drawing. The thresholds were fixed before anything was measured: correlation at least 0.5, and at least 0.2 better than the same voice played backwards. The hologram must also be at least 1.1× brighter while speaking than while silent, and keep moving while silent: the change from one tenth of a second to the next, averaged over each two seconds of silence, must be at least 1/255 per pixel in every one of them. Averaged, because screenrecord only emits a frame when the screen changes, so at an emulator's frame rate most tenth-second pairs are one frame repeated.

The script boots its own AVD, `jarvis-hologram-check`, and prints how to create it when it is missing; a device that is already attached is used instead, and the script says so.

**It passes.** It was run on 2026-09-15 on the same WSL2 machine, against AVD `jarvis-hologram-check`: the same android-34 `google_apis` x86_64 image at 540×960 and 240 dpi, 4 cores, 2 GB, `-gpu swiftshader_indirect`. The results:

| Measure | Result | Threshold |
| --- | --- | --- |
| Correlation with the voice | 0.719 | ≥ 0.5 |
| Correlation with the reversed voice | 0.344 (margin 0.375) | margin ≥ 0.2 |
| Brightness, speaking ÷ silent | 57.6 ÷ 34.1 = 1.69 | ≥ 1.1 |
| Mean change per tenth of a second, stillest two seconds of silence | 1.06 (1.69 over all silence, 5.36 speaking) | ≥ 1 in every two seconds |

That last margin is thin, and why matters before anyone reads it as a hologram that nearly stopped. The stillest two seconds were the first after speech ended. They held five distinct frames, like the two seconds after them, each differing from the one before by 4.2/255 per pixel against 7.1–7.6 later. The hologram was moving throughout. What pulls the number down is the emulator's frame rate: with five frames in twenty tenth-second samples, three samples in four are one frame repeated and count as 0. A slower emulator run could fail this check with nothing wrong in the app. The threshold was set before this run and has been left where it is.

An earlier run on the same AVD failed that check, correctly: the clock then capped each frame's step at 100 ms. At the emulator's roughly 370 ms a frame, that turned the hologram at about a quarter of real speed (stillest two seconds 0.99, all silence 1.22). The cap is gone.

The stills it leaves in `tests/hologram-preview/evidence/` show the same thing by eye: during silence, a dim sphere of thin arcs that keeps turning; during speech, a brighter and fuller one.

Read those numbers with three caveats:

- **The voice was replayed eight times slower than it was spoken.** The emulator draws with a software GPU. The recording holds 487 distinct frames in 180 s, about 2.7 a second. Profiling the app on the larger Pixel 6 AVD with `simpleperf` put most of each frame in carrying GL calls through the emulator's pipe: about 64% kernel and GL transport, 12% Skia, 4% Hermes. At that rate, syllables four times a second cannot be followed however correct the app is. The slowdown was set for that reason before any measurement, and it only stretches how long each reading lasts: the folding, the real-time easing, the drawing and the thresholds are unchanged. `-gpu host` crashed this machine's emulator (D3D12/Vulkan under WSL2), and `-gpu guest` fell back to a slower software renderer. Earlier runs stopped on the environment, before producing a measurement: an emulator killed by a segfault while Gradle compiled beside it, "not responding" dialogs over the app, and `adb input text` dropping characters. The script handles each of these.
- **The replay is not what the Android SDK hands over.** On Android, `getOutputVolume` and `getOutputByteFrequencyData` come from LiveKit's native processors (`@livekit/react-native` 2.12.0), not an `AnalyserNode`. Their spectrum is a comb: the SDK asks for 1024 bars, but at 48 kHz only 169 FFT bins fall in 100–8000 Hz, so every bar between two of them reads 0, and two of the hologram's 24 bands can never light. Their volume reads 16-bit samples from a big-endian `ByteBuffer` over little-endian audio — WebRTC's native library never sets a byte order on it — so anything louder than near-silence reads close to full scale. The spectrum follows from the arithmetic in `MultibandVolumeProcessor.kt`; the byte order is read from the code, not yet seen on a device. Either way, the pulse on a phone would be flatter and more on/off than the replay shows.
- **Not checked:** how smooth it is on a phone's GPU at full frame rate, and whether it follows a live ElevenLabs session rather than a replay. `jarvis-voice.ts` reads `getOutputVolume` and `getOutputByteFrequencyData` in `try`/`catch` and treats a failure as silence. A real session that never feeds the processors would show a hologram that turns but never swells, not an error.

## Scope Guidelines for Commits

Use mobile-specific scopes: `mobile`, `assistant`, `conversation`, `settings`.
