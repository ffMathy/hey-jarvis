# Mobile App

> **Note:** See the root [AGENTS.md](../AGENTS.md) for shared conventions (Turborepo commands, commit standards, 1Password, etc.)

## Overview

An Expo app that registers as the phone's **default digital assistant** on Android, replacing Gemini or Google Assistant, and answers as Jarvis over a live ElevenLabs voice conversation.

Android only. Apple does not let an app replace Siri, so an iOS target would ship something that cannot do the one thing this project exists for.

## TURBO Commands

```bash
bunx turbo lint --filter=mobile       # Biome
bunx turbo typecheck --filter=mobile  # tsgo
bunx turbo test --filter=mobile       # the offline suite
bunx turbo build --filter=mobile      # bundles the JS for Android into dist/mobile
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
    └── settings-storage.ts       # expo-secure-store
```

## Configuration

The app ships with no server address and no credential. Both are typed into the settings screen on first run and kept in `expo-secure-store`:

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

## Testing

Everything under `src/` that can be tested without a device is, and it runs in the ordinary offline suite:

```bash
bunx turbo test --filter=mobile
```

Tests must not import React Native or any Expo native module — there is no runtime for them under `bun test`. Keep logic worth testing in plain `.ts` files (`assist-link.ts`, `server-settings.ts`, `conversation-token.ts`) and let the `.tsx` files stay thin enough to read.

`turbo build` bundles the JavaScript with Metro rather than assembling an APK. That needs no Android SDK, so it runs in CI, and it still catches the failures a bundle can catch: an import that does not resolve, a native module missing from the tree, a file no test imports. The installable build comes from EAS.

## Scope Guidelines for Commits

Use mobile-specific scopes: `mobile`, `assistant`, `conversation`, `settings`.
