---
paths:
  - "watch/**"
---

# Wear OS App

> Paths in this rule are relative to `watch/` unless they say otherwise.

## Its rules

Each topic is a rule of its own, under the same paths:

- [What is in here](watch-what-is-in-here.md)
- [TURBO Commands](watch-turbo-commands.md)
- [Credentials: the phone hands them over](watch-credentials-the-phone-hands-them-over.md)
- [The conversation](watch-the-conversation.md)
- [His body on the GPU](watch-his-body-on-the-gpu.md)
- [What has been verified](watch-what-has-been-verified.md)
- [Getting it onto a watch](watch-getting-it-onto-a-watch.md)
- [Trying it on a Pixel Watch](watch-trying-it-on-a-pixel-watch.md)

## Overview

Jarvis on the wrist: an Expo app that draws the same sphere the phone does, holds a live conversation with the same ElevenLabs agent, and registers as the watch's digital assistant.

**Nothing is ever typed here.** There is no settings screen and no keyboard on the critical path: the ElevenLabs API key is fifty characters beginning `sk_`, and a watch is not where anybody should enter one. It arrives from the phone over the Wearable Data Layer instead — see [Credentials](watch-credentials-the-phone-hands-them-over.md#credentials-the-phone-hands-them-over) — and once it has, the watch holds conversations on its own with the phone out of range, asleep or absent.

**The sphere is not a copy, and neither is the conversation.** Both come from [`hologram/`](hologram.md), the workspace package the phone app bundles from too — the drawing and the voice tracking from its main entry, the sphere itself from `hologram/react`, and the ElevenLabs credentials, the token request and the conversation itself from its main entry and `hologram/conversation`. Changing how Jarvis looks, or what ElevenLabs saying no means, is one edit in one place and both apps follow. What lives here is only what a watch does differently: a round screen drawn edge to edge, an assistant gesture that arrives as an intent, and a credential that arrives from a phone.

It was a plain Gradle project in Kotlin until 2026-09-16, on the belief that Expo does not target Wear OS. It does — a Wear OS app is an Android app with `uses-feature android.hardware.type.watch` — and the cost of the other arrangement was a second Jarvis to keep in step with the first.

## How it becomes the assistant

`withWatchAssistant` in `app.config.ts` gives the app's one activity an intent filter for `android.intent.action.ASSIST` and `VOICE_ASSIST`. That is the whole registration — no `VoiceInteractionService`, unlike the phone app. Wear OS offers any app with such an activity under **Digital assistant app**, which is how Home Assistant's watch app is registered too.

The same plugin declares `uses-feature android.hardware.type.watch`, which is what makes this a watch app and keeps it off phones — load-bearing here, because it shares the phone app's package name — and the `standalone` meta-data, so it installs without the phone app.

`applicationId` is the phone app's, `com.ffmathy.heyjarvis`. The Wearable Data Layer only connects a phone app and a watch app that share a package name and a signing key, and the real app will need it.

## Signing

Release builds are signed with the debug keystore the Expo template generates into `android/app` — the same well-known key on every machine, and the same one the phone APK uses. Builds from CI and from a laptop therefore install over each other, which the old Gradle prototype's per-machine debug key did not (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`), and the two apps already share the key the Data Layer will want.

It is not fit for distribution: anyone holding that key can sign an "update" Android will accept.
