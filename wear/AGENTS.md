# Wear OS App

> **Note:** See the root [AGENTS.md](../AGENTS.md) for shared conventions (Turborepo commands, commit standards, 1Password, etc.)

## Overview

A **prototype** Wear OS app that answers one question before any real watch app is built: will the watch hand its assistant gesture to Jarvis?

It has no conversation yet. It is one native activity that registers as a digital assistant and says on screen how it was opened — by the assistant gesture, or from the app list — so pressing the button on a real watch answers the question without a cable attached. The same line is logged under `JarvisWear`.

It is a plain Gradle project in Kotlin, not part of the Expo app in `mobile/`: Expo does not target Wear OS, and a watch app wants a UI built for a small round screen.

## TURBO Commands

```bash
bunx turbo build:apk --filter=wear   # dist/wear-apk/jarvis-wear.apk (needs JDK 17+ and the Android SDK)
```

There is no `build`, `lint` or `test` task, on purpose: CI's `turbo build` runs in a dev container with no Android SDK, and this project has nothing but a Gradle build. The **Wear APK** workflow (`.github/workflows/wear-apk.yml`) builds it on the runner whenever `wear/**` changes, and uploads `jarvis-wear-<commit>.apk`, unzipped, as the run's artifact.

## How it becomes the assistant

`app/src/main/AndroidManifest.xml` gives `AssistActivity` an intent filter for `android.intent.action.ASSIST` and `VOICE_ASSIST`. That is the whole registration — no `VoiceInteractionService`, unlike the phone app. Wear OS offers any app with such an activity under **Digital assistant app**, which is how Home Assistant's watch app is registered too.

`applicationId` is the phone app's, `com.ffmathy.heyjarvis`. The Wearable Data Layer only connects a phone app and a watch app that share a package name and a signing key, and the real app will need it.

## Credentials, for the real app

Like the phone app, the watch app will talk to ElevenLabs directly with an ElevenLabs API key and the Jarvis agent ID — no server in between — and will keep the key in the **watch's own Android Keystore**, never in its APK or in plain preferences. The key should reach the watch from the phone over the Data Layer rather than be typed on it: a key is long, and a watch keyboard is not where anyone should enter one. Once it arrives, the watch stores it and no longer needs the phone to be nearby to start a conversation. None of this exists yet; the prototype holds no credential at all.

## What has been verified

On 2026-09-15, on emulators of both current Wear OS releases — `system-images;android-37.0;android-wear-signed;x86_64` (Wear OS 7, Android 17, what Pixel Watch 2–4 run since June 2026) and `android-36.1;android-wear-signed` (Wear OS 6.1) — both `user` builds with release keys, in the `wearos_large_round` profile. The same results on both:

- **Settings → Apps → Default apps → Digital assistant app** exists. Before install nothing handles `ASSIST` and the role is empty; after install Jarvis is the only handler.
- Tapping **Default digital assistant app** lists `None` and `Jarvis`. Choosing Jarvis asks for confirmation ("Change your digital assistant app to Jarvis?" on 7), and accepting it makes `com.ffmathy.heyjarvis` the `android.app.role.ASSISTANT` holder and `.wear.AssistActivity` the secure `assistant` setting.
- From the launcher, with Jarvis force-stopped first, `KEYCODE_ASSIST` brings `AssistActivity` to the front with `ASSIST`.
- **Holding the side button** (`KEYCODE_STEM_PRIMARY`, long press) — the Pixel Watch's assistant gesture — does the same.
- A short press of the side button opens Recents and does not start Jarvis, so it is the long press that is routed, not any press.

Not yet verified, and only a real watch can say:

- **With Gemini installed.** The emulator images ship no assistant, so the picker listed only Jarvis. A Pixel Watch lists Gemini too; choosing Jarvis should replace it, but that has not been seen.
- **The physical button.** The emulator's long press arrived as two `ASSIST` starts a moment apart, where the key event arrived as one. It may be how the emulator injects a long press; the real app has to treat a repeat as the same summoning either way, as the phone app's `createAssistLaunchClaim` already does.

## Trying it on a Pixel Watch

1. Get the APK: the latest **Wear APK** run's artifact, or `bunx turbo build:apk --filter=wear`.
2. On the watch, turn on developer options (tap **Settings → System → About → Versions → Build number** seven times), then **Settings → Developer options → Wireless debugging**. The exact path can differ between releases.
3. Under Wireless debugging, choose **Pair new device** and pair from a computer on the same Wi-Fi: `adb pair <ip>:<pairing port>` with the code shown, then `adb connect <ip>:<port>`.
4. `adb install jarvis-wear-<commit>.apk`
5. On the watch: **Settings → Apps → Default apps → Digital assistant app → Default digital assistant app → Jarvis**, and confirm.
6. Hold the side button. The screen should read "Opened by the assistant gesture (ASSIST)" with the time.

To put things back, choose Gemini again in the same place, and uninstall with `adb uninstall com.ffmathy.heyjarvis` — which, since the package name is shared, is also what removes the phone app if it is the phone that is connected, so check which device `adb devices` lists.

## Signing

Release builds are signed with the building machine's own debug key. So is every CI run, and each runner generates a fresh one — so a CI build will not install over a previous CI build or a local one (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`); uninstall first. The phone APK, by contrast, uses the Expo template's fixed debug key. Before the watch and phone apps talk to each other they need the same key, and that decision belongs with the real app rather than this prototype.
