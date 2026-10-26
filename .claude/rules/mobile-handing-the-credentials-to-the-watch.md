---
paths:
  - "mobile/**"
---

# Handing the credentials to the watch

> Part of [Mobile App](mobile.md). Paths in it are relative to `mobile/` unless they say otherwise.

The watch app talks to ElevenLabs directly, exactly as this one does, and it needs the same two values. It never asks for them: an API key is fifty characters beginning `sk_`, and a watch is not where anybody should type one. This app sends them over the Wearable Data Layer instead.

Both halves of the plumbing are in `modules/jarvis-watch`, beside the capability lookup that was already there:

- **`sendSettingsToTheWatch`** puts them on `/jarvis/elevenlabs-settings` as a JSON message, addressed to a node advertising the `jarvis_on_the_watch` capability — the capability rather than the connected nodes, because a message to a watch without the app is accepted by Play Services and then dropped, which would look exactly like a successful handover.
- **`whenTheWatchAsksForCredentials`** hears `/jarvis/ask-for-credentials`, which the watch sends whenever it starts with none. `src/answer-the-watch.ts` mounts that for the life of the app and answers it without a prompt; the note on that file argues why no prompt is the right default, and it is worth reading before changing it.

Only a *running* phone app can answer an ask, because the credentials are behind the keystore in JavaScript's hands rather than in the native module that hears the question. That asymmetry is the whole reason the watch's own screen says "open Jarvis on your phone" rather than waiting silently, and the reason the watch card also has a button: a watch that is not running when the button is pressed still receives, because on that side a `WearableListenerService` takes the message. See [`.claude/rules/watch.md`](watch.md).

**A message rather than a `DataItem`** is a security decision. See the note in `JarvisWatchModule.kt`: a data item replicates by being stored, in Play Services' own store on both devices, which is a live API key at rest somewhere neither app controls.

Four strings hold this together — two paths, each spelled in Kotlin and in TypeScript, on each of two devices — with no compiler between any of them. `src/watch-link.contract.spec.ts` reads all of them out of their sources, along with the manifest entry that wakes the watch, and fails if they drift.

## Answering the watch in the earbuds

`modules/jarvis-assistant/.../JarvisWatchSummonService.kt` is a `WearableListenerService` for Data Layer *requests* on `/jarvis/answer-on-the-phone`. The watch sends one on every summoning. If a Bluetooth headset is connected, the phone isn't locked behind a PIN, and Jarvis holds the assistant role, it calls `showSession` on `JarvisVoiceInteractionService`. That opens the same window the phone's own gesture opens, so the conversation goes to the AirPods and not out of the watch's speaker. It replies `1` only once `JarvisVoiceInteractionSession.onShow` has run. If that takes longer than two seconds it replies `0`, and the watch talks for itself. Nothing public can cancel a session once `showSession` has asked for it, so a window that opens later than that means two of him talk at once. The window normally opens within a few hundred milliseconds or not at all. See [the watch's notes](watch-the-conversation.md#the-conversation).
