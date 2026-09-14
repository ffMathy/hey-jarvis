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
bunx turbo e2e --filter=mobile        # exports for web and drives it in Chromium
```

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
                 ├─ POST /api/voice/conversation-token   → the MCP server
                 └─ WebRTC session                       → the ElevenLabs Jarvis agent
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
    ├── conversation-screen.tsx
    ├── settings-screen.tsx
    ├── assist-link.ts            # what "opened by the assistant" looks like
    ├── conversation-token.ts     # the call to the MCP server
    ├── server-settings.ts        # validation of what the user typed
    ├── settings-storage.ts       # platform-agnostic half of persistence
    ├── platform-contracts.ts     # the shapes the .web.ts pairs below must keep
    ├── key-value-store.ts        # keystore on Android …
    ├── key-value-store.web.ts    # … localStorage in a browser
    ├── microphone-permission.ts      # PermissionsAndroid …
    └── microphone-permission.web.ts  # … getUserMedia
```

## Configuration

The app ships with no server address and no credential. Both are typed into the settings screen on first run and kept in the Android keystore — or, on web, in `localStorage`:

| Setting | What it is |
| --- | --- |
| Server address | The Jarvis MCP server, over **https** — the access token goes with every request |
| Access token | The value of `HEY_JARVIS_MOBILE_APP_ACCESS_TOKEN` on that server |

The ElevenLabs API key never reaches the phone. `POST /api/voice/conversation-token` on the MCP server mints a single short-lived WebRTC conversation token per conversation; that endpoint refuses to answer at all unless `HEY_JARVIS_MOBILE_APP_ACCESS_TOKEN` is set, so an unconfigured server is a closed one rather than an open one.

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

`eas.json` pins bun to `1.3.14` in a `base` profile the three real profiles extend. Without it an EAS build uses whatever bun its image happens to ship, while the repository pins `packageManager` and `engines.bun` — so keep the three in step. It has to be an exact version; the schema validates it with `semver.valid`, which rejects a range.

## Web

`platforms` includes `web`, and the conversation genuinely works there: `@elevenlabs/react-native` resolves through its `browser` export condition to the plain `@elevenlabs/react` build, which speaks WebRTC through the browser rather than through LiveKit's native modules. The same components, the same provider, no branching in the screens.

Two things do differ, and each is a pair of files Metro picks between rather than a conditional:

- **Storage.** `expo-secure-store` ships `export default {}` as its web implementation, so the native path does not degrade on web — it throws. `key-value-store.web.ts` uses `localStorage` instead, and the settings screen says so, because `localStorage` is not a keystore.
- **The microphone.** `PermissionsAndroid` is not part of `react-native-web`. `microphone-permission.web.ts` asks by requesting a stream and releasing it again, so a refusal still surfaces as a permission problem rather than as a failed connection.

`platform-contracts.ts` holds the types both halves implement, so neither can drift — nothing else in the app imports both.

What does **not** work on web is the assistant role, and it never will: it is Android's. The assistant card says that outright instead of offering a setup step that leads nowhere.

## Testing

Everything under `src/` that can be tested without a device is, and it runs in the ordinary offline suite:

```bash
bunx turbo test --filter=mobile
```

Tests must not import React Native or any Expo native module — there is no runtime for them under `bun test`. Keep logic worth testing in plain `.ts` files (`assist-link.ts`, `server-settings.ts`, `conversation-token.ts`) and let the `.tsx` files stay thin enough to read.

`turbo build` bundles the JavaScript with Metro rather than assembling an APK. That needs no Android SDK, so it runs in CI, and it still catches the failures a bundle can catch: an import that does not resolve, a native module missing from the tree, a file no test imports. The installable build comes from EAS.

### The browser tests

`turbo e2e --filter=mobile` exports the production web build and drives it in Chromium — the real bundle, served over HTTP, clicked through. It runs in CI alongside the rest.

The boundary is the ElevenLabs session, which needs a real conversation token and real quota. Everything up to it is exercised for real: settings validation, persistence across a reload, the assistant card's web state, and the request to `/api/voice/conversation-token` with its bearer token and participant name. The token endpoint is intercepted with `page.route`, and every non-localhost request is aborted so a test can never dial out.

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

What the script does **not** cover is whether the conversation then starts on its own, because that needs a configured server. It was checked by hand on the same emulator, pointing the app at a local listener that logs one line per token request — one line per `start()`. That found a real bug: only the first summoning after the app process started opened the microphone, and every later one brought Jarvis to the front and waited for a tap (`0, 0, 0` requests for three summonings; `1` for tapping Talk). The system keeps an assistant's process alive while it holds the role, so on a phone that is almost every summoning. It is fixed — each summoning now carries a `summon` value that differs every time, and the screen claims each URL once per process (`createAssistLaunchClaim` in `assist-link.ts`) — and the same measurement then gave one request for every summoning. One summoning out of fourteen after the fix produced no request, immediately after a reinstall, and did not happen again in thirteen further attempts, including ones that recreated those conditions; its log had already been cleared, so its cause is unknown.

Two things the emulator showed about the role itself, both Android's behaviour rather than the app's: **Force stop** and **Clear storage** on Jarvis's App info screen each hand the assistant role straight back to the default — `VoiceInteractionManager` logs `Force stopping current voice interactor` and clears the role holder. An app update and ordinary process death keep it. So a user who force-stops Jarvis has to pick it again in Settings, and the assistant card will say so when the app next comes to the foreground.

What guards the handover in the meantime is `src/assist-link.contract.spec.ts`: it reads the URL out of `AssistLauncher.kt`, the `scheme` out of `app.config.ts` and `ASSIST_URL` out of `assist-link.ts`, and fails if they disagree. That drift is silent otherwise — the build passes, the app installs, the registration stays valid, and the gesture opens an app that waits to be asked again.

Two things that would otherwise ride on reasoning alone have been checked another way, and are worth re-checking the same way if the manifest or the Kotlin changes:

- The Kotlin compiles against a real `android.jar`, which is what catches a misused framework API.
- The library manifest merges as intended. Running AGP's own `ManifestMerger2` over the generated app manifest plus this module's and LiveKit's, with `REMOVE_TOOLS_DECLARATIONS` on, puts all four components in the output with `exported="true"` and `BIND_VOICE_INTERACTION` intact, and confirms `blockedPermissions` really does drop LiveKit's `CAMERA`.

## Scope Guidelines for Commits

Use mobile-specific scopes: `mobile`, `assistant`, `conversation`, `settings`.
