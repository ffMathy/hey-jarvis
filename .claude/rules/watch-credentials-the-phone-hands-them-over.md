---
paths:
  - "watch/**"
---

# Credentials: the phone hands them over

> Part of [Wear OS App](watch.md). Paths in it are relative to `watch/` unless they say otherwise.

The watch talks to ElevenLabs directly with an API key and the Jarvis agent ID, exactly as the phone does — no server in between. What differs is where they come from. **They are never typed on the watch.** The phone's first-run tour asks for them once, on a keyboard, and hands them across the Wearable Data Layer.

That is the supported answer rather than a workaround, and both of its preconditions were already met here before any of it was built: Play Services only connects a phone app and a watch app that share an `applicationId` *and* a signing key, and this app deliberately shares both with `mobile/` — see the notes on the package name and on [signing](watch.md#signing).

## The protocol

Two message paths, and that is the whole of it:

| Path | Direction | Carries |
| --- | --- | --- |
| `/jarvis/elevenlabs-settings` | phone → watch | `{"apiKey": …, "agentId": …, "serverAddress"?: …, "serverToken"?: …}` |
| `/jarvis/ask-for-credentials` | watch → phone | nothing at all |
| `/jarvis/answer-on-the-phone` | watch → phone, a request | nothing; the reply is one byte, 1 if the phone took the conversation |
| `/jarvis/mirror-the-phone` | phone → watch | a 29-byte frame of the phone's sphere, about every 80 ms; empty when he has stopped |

The last two paths aren't part of the handover. It's how a summoning moves to the phone's earbuds: see [The conversation](watch-the-conversation.md#the-conversation).

`serverAddress` is there only when the phone has a **Jarvis server** address: the watch keeps it beside the credentials and opens the same line to the server the phone does, from `app.tsx` (`useJarvisServer`), for as long as the app runs — between conversations too (`jarvis-server-link.ts` in `hologram`). `serverToken` comes with it when the phone has one: the JWT for the Cloudflare Zero Trust application in front of the server, kept encrypted beside the ElevenLabs key (`PhoneSettingsStore.kt`) and sent on the line's upgrade request as `Authorization: Bearer` and `cf-access-token`. A watch that already has credentials does not ask again, so an address or token set on the phone afterwards reaches it with the watch card's button.

The watch asks on every start it makes with no credentials, and again every few seconds while it is waiting. The phone answers two ways: automatically whenever it hears the request and has credentials (`mobile/src/answer-the-watch.ts`), and on demand from the button on the watch card in its own settings.

**A message and not a `DataItem`, and that is a security decision rather than a convenience one.** `DataClient` would be easier — a data item replicates on its own and arrives whenever the watch next comes into range, with no need for either app to be open — but it replicates *by being stored*, in Play Services' own store on both devices, which is a live API key at rest in a place neither app controls. A message is handed to the receiving app and kept nowhere in between.

## Where they land

`PhoneSettingsStore.kt`, in `EncryptedSharedPreferences`: AES-GCM under a key held in the **watch's own Android Keystore**, which never leaves it. Not `expo-secure-store`, which is what the phone uses, and the reason is the service beside it — the credentials arrive in a `WearableListenerService` that Play Services starts when a message lands, often with no React Native runtime alive at all, so the store has to be readable and writable from Kotlin.

The same caveats apply as to the phone's copy: the keystore keeps the key from other apps and out of backups, and does **not** protect it from an update of this app — and with a debug-signed side-loaded APK, that is easy. Never install a pull request's APK over an install holding your real key.

## Why the watch does not get a tour of its own

The phone's first-run tour explains what an ElevenLabs agent is, asks for the two values, and recommends the assistant role. None of that belongs on a watch. Signing up for ElevenLabs and building an agent is laptop work; the credentials are the phone's to type; and the assistant role on Wear OS is chosen in the watch's own Settings, which no app can open on the user's behalf. What is left for the watch to say is one line — "open Jarvis on your phone" — which is what `waiting-for-the-phone.tsx` says.

Around that line the screen is the phone's **sample mode**, since until the phone answers there is nothing else for Jarvis to do: tapping him walks speaking, listening, thinking and at rest, the mood's name shows for a moment, and the frame rate and particle count sit small at the top. The moods, the simulated voice, the toast and the readout all come from `hologram` (`sample-mode.ts`, `sample-drive.ts` and `hologram/react/sample`), exactly as the phone's do; only the layout is the watch's, kept clear of a round bezel. The readout is on this screen only — the conversation screen has nothing on it but him.

One case has no phone to ask at all: the app declares `com.google.android.wearable.standalone`, so it installs on a watch whose phone has never had Jarvis. That case gets the same screen and the same line, because the answer is the same: install Jarvis on the phone.
