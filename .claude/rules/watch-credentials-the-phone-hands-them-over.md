---
paths:
  - "watch/**"
---

# Credentials: the phone hands them over

> Part of [Wear OS App](watch.md). Paths in it are relative to `watch/` unless they say otherwise.

The watch talks to sir's Jarvis server, exactly as the phone does: every conversation is asked of the server (`pairedCredentials` in `hologram`, under `WATCH_PARTICIPANT_NAME`), which holds the ElevenLabs key and asks ElevenLabs on the watch's behalf, and the line to it opens on `/api/paired/live`. What differs is where the pairing comes from. **The watch never pairs on its own**: pairing signs in to Cloudflare Access in a browser, and a watch has none. It **shares the phone's pairing** — the server's address and the device token the server gave the phone — handed across the Wearable Data Layer. So **unpairing the phone on the server unpairs the watch too**, and the watch then says the line the server's refusal says, until the phone is paired again and sends it the new token.

That is the supported answer rather than a workaround, and both of its preconditions were already met here before any of it was built: Play Services only connects a phone app and a watch app that share an `applicationId` *and* a signing key, and this app deliberately shares both with `mobile/` — see the notes on the package name and on [signing](watch.md#signing).

## The protocol

Two message paths, and that is the whole of it:

| Path | Direction | Carries |
| --- | --- | --- |
| `/jarvis/server-pairing` | phone → watch | `{"serverAddress": …, "deviceToken": …}` |
| `/jarvis/ask-for-credentials` | watch → phone | nothing at all |
| `/jarvis/answer-on-the-phone` | watch → phone, a request | nothing; the reply is one byte, 1 if the phone took the conversation |
| `/jarvis/mirror-the-phone` | phone → watch | a 29-byte frame of the phone's sphere, about every 80 ms; empty when he has stopped |

The last two paths aren't part of the handover. It's how a summoning moves to the phone's earbuds: see [The conversation](watch-the-conversation.md#the-conversation).

It used to carry `{"apiKey", "agentId", "serverAddress"?, "serverClientId"?, "serverClientSecret"?}` on `/jarvis/elevenlabs-settings`: an ElevenLabs key and agent, and a Cloudflare Access service token for the line. No app holds any of them now. `PhoneSettingsStore.kt` removes those fields on every save, so a watch updated from that version keeps no live key it will never read.

`readPhonePairing` in `modules/jarvis-phone` reads the stored pair back and checks it by the rules the phone checked it with (`parseJarvisServerAddress` and `parseStoredDeviceToken` in `hologram`); anything that is not both an address and a token is no pairing, and the watch waits for the phone again. `app.tsx` holds the line with `useJarvisServer(address, 'watch', deviceToken)` for as long as the app runs — between conversations too.

The watch asks on every start it makes with no pairing, and again every few seconds while it is waiting. The phone sends it three ways (`mobile/src/answer-the-watch.ts`): automatically whenever it hears the request, automatically whenever its pairing is new — read at launch, or paired again — and on demand from the button on the watch card in its tour and its settings. A watch that already has a pairing does not ask and does not listen; a newer one sent meanwhile lands in the store, by way of the listener service, and is read the next time the app starts.

**A message and not a `DataItem`, and that is a security decision rather than a convenience one.** `DataClient` would be easier — a data item replicates on its own and arrives whenever the watch next comes into range, with no need for either app to be open — but it replicates *by being stored*, in Play Services' own store on both devices, which is a live token at rest in a place neither app controls. A message is handed to the receiving app and kept nowhere in between.

## Where it lands

`PhoneSettingsStore.kt`, in `EncryptedSharedPreferences`: AES-GCM under a key held in the **watch's own Android Keystore**, which never leaves it. Not `expo-secure-store`, which is what the phone uses, and the reason is the service beside it — the pairing arrives in a `WearableListenerService` that Play Services starts when a message lands, often with no React Native runtime alive at all, so the store has to be readable and writable from Kotlin.

The same caveats apply as to the phone's copy: the keystore keeps the token from other apps and out of backups, and does **not** protect it from an update of this app — and with a debug-signed side-loaded APK, that is easy. Never install a pull request's APK over an install holding your real pairing; if you did, unpair the phone on the server, which unpairs the watch with it.

## Why the watch does not get a tour of its own

The phone's first-run tour says what the Jarvis server is, pairs with it, and recommends the assistant role. None of that belongs on a watch. Pairing is a sign-in in a browser; the phone's pairing is the one the watch uses anyway; and the assistant role on Wear OS is chosen in the watch's own Settings, which no app can open on the user's behalf. What is left for the watch to say is one line — "open Jarvis on your phone" — which is what `waiting-for-the-phone.tsx` says.

Around that line the screen is the phone's **sample mode**, since until the phone answers there is nothing else for Jarvis to do: tapping him walks speaking, listening, thinking and at rest, the mood's name shows for a moment, and the frame rate and particle count sit small at the top. The moods, the simulated voice, the toast and the readout all come from `hologram` (`sample-mode.ts`, `sample-drive.ts` and `hologram/react/sample`), exactly as the phone's do; only the layout is the watch's, kept clear of a round bezel. The readout is on this screen only — the conversation screen has nothing on it but him.

One case has no phone to ask at all: the app declares `com.google.android.wearable.standalone`, so it installs on a watch whose phone has never had Jarvis. That case gets the same screen and the same line, because the answer is the same: install Jarvis on the phone.
