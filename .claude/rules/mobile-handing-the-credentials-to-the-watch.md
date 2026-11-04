---
paths:
  - "mobile/**"
---

# Handing the credentials to the watch

> Part of [Mobile App](mobile.md). Paths in it are relative to `mobile/` unless they say otherwise.

The watch talks to the same Jarvis server this phone is paired with, and it never pairs on its own: pairing signs in to Cloudflare Access in a browser, and a watch has none. It **shares the phone's pairing** — the server's address and the device token the server gave the phone — which this app sends it over the Wearable Data Layer. So **unpairing the phone on the server unpairs the watch too**: the server knows one device, "Android phone", and both of them are it.

Both halves of the plumbing are in `modules/jarvis-watch`, beside the capability lookup that was already there:

- **`sendPairingToTheWatch`** puts it on `/jarvis/server-pairing` as a JSON message, `{"serverAddress": …, "deviceToken": …}`, addressed to a node advertising the `jarvis_on_the_watch` capability — the capability rather than the connected nodes, because a message to a watch without the app is accepted by Play Services and then dropped, which would look exactly like a successful handover.
- **`whenTheWatchAsksForCredentials`** hears `/jarvis/ask-for-credentials`, which the watch sends whenever it starts with none.

`src/answer-the-watch.ts` mounts both for the life of the app, and sends without a prompt — the note on that file argues why no prompt is the right default, and it is worth reading before changing it — at two moments: **when the watch asks**, and **whenever the pairing is new** (read at launch, or the phone paired again). The second is what keeps a watch from going on with a token the server no longer knows: a watch that has a pairing never asks again. A watch out of range when that happens misses it, and the **watch card** — on the tour's assistant step and on the settings screen — has a button to send it again.

Only a *running* phone app can answer an ask, because the pairing is behind the keystore in JavaScript's hands rather than in the native module that hears the question. That asymmetry is the whole reason the watch's own screen says "open Jarvis on your phone" rather than waiting silently, and the reason the watch card also has a button: a watch that is not running when the button is pressed still receives, because on that side a `WearableListenerService` takes the message. See [`.claude/rules/watch.md`](watch.md).

**A message rather than a `DataItem`** is a security decision. See the note in `JarvisWatchModule.kt`: a data item replicates by being stored, in Play Services' own store on both devices, which is a live token at rest somewhere neither app controls.

Four strings hold this together — two paths, each spelled in Kotlin and in TypeScript, on each of two devices — with no compiler between any of them, and the payload's two field names besides. `src/watch-link.contract.spec.ts` reads all of them out of their sources, along with the manifest entry that wakes the watch, fails if they drift, and fails if an ElevenLabs key, an agent ID or an Access service token is ever handed over again.

## Answering the watch in the earbuds

`modules/jarvis-assistant/.../JarvisWatchSummonService.kt` is a `WearableListenerService` for Data Layer *requests* on `/jarvis/answer-on-the-phone`. The watch sends one on every summoning. If a Bluetooth headset is connected and Jarvis holds the assistant role, it calls `showSession` on `JarvisVoiceInteractionService`. That opens the same window the phone's own gesture opens, so the conversation goes to the AirPods and not out of the watch's speaker. A locked phone answers too, since the window stays up over the lock screen: the phone in a pocket with earbuds in is the case this exists for. It replies `1` only once `JarvisVoiceInteractionSession.onShow` has run. If that takes longer than two seconds it replies `0`, and the watch talks for itself. Nothing public can cancel a session once `showSession` has asked for it, so a window that opens later than that means two of him talk at once. The window normally opens within a few hundred milliseconds or not at all. See [the watch's notes](watch-the-conversation.md#the-conversation).
