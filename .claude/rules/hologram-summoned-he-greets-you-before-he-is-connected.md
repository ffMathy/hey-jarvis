---
paths:
  - "hologram/**"
---

# Summoned, he greets you before he is connected

> Part of [Hologram](hologram.md). Paths in it are relative to `hologram/` unless they say otherwise.

The voice firmware's trick, on every device, and the session's (`jarvis-session.ts`): "Hello sir,
how can I help?" plays from `assets/greeting.mp3` — the firmware's own recording — the moment he is
summoned, the token is fetched beside it, and the agent is told to skip its first message
(`overrides: { agent: { firstMessage: '' } }`, the firmware's `first_message: ""`). While it plays
the sphere follows `createGreetingReaders` at the player's own position, and a session dialled
behind it has its microphone muted from `onConversationCreated` until it ends, so the agent does not
hear Jarvis through the speaker as the user. `isGreetingOver` (`greeting-handover.ts`) decides the
end: the recording's end, or its length plus a grace if playback never started — a clock that starts
again once a headset's call link is up, since that wait was not him being late. The things that are
easy to break:

- **On a phone and a watch, he greets as call audio, inside the call's audio session.** Played by
  expo-audio — media, `USAGE_MEDIA` — the recording was not heard on a phone: not on its own, and
  not inside LiveKit's audio session started before him either (tested on a phone). So the session
  first starts the audio session the SDK would (`callAudio`, which `useJarvisSession` fills with
  `call-audio.ts`: the `communication` preset, on the speaker), and then plays
  the recording through this package's own native module, `JarvisGreeting`
  (`android/.../JarvisGreetingModule.kt`), a `MediaPlayer` with `USAGE_VOICE_COMMUNICATION` — the
  stream, route and volume Jarvis's voice uses a moment later. It prefers a Bluetooth headset, then
  a wired one, then the speaker, so the greeting comes out where the conversation will — started on
  the speaker alone, as the SDK does, he greeted from the phone and answered in the AirPods. On a
  Bluetooth headset he then waits for its call link to come up (`untilCallRouteReady`, at most
  2.5 s plus a 250 ms margin, the player's `untilAudible`): played into straight away, AirPods lost
  his first word. LiveKit's `start` does nothing when the SDK calls it again. The session lets the
  call's audio go at once when nothing was dialled — a refused greeting, a hang-up, a token that
  never came — so no call audio is left with no call.
- **Call mode is switched off the main thread, by this package.** Reanimated draws the sphere on
  Android's main thread, and LiveKit switches the device into `MODE_IN_COMMUNICATION` there as its
  session starts — which Android takes a noticeable moment over, so the sphere froze once in every
  arrival, just as the greeting began. So `startCallAudio` first has `JarvisGreeting`'s
  `enterCallMode` switch it on a thread of its own and wait for it, and LiveKit then asks for the
  mode already in force. LiveKit also remembers that as the mode to put back, so `stopCallAudio`
  does the putting back: after LiveKit's stop (a bridge call that only *posts* to the main thread,
  so `getAudioOutputs` on the same bridge queue is awaited first as a barrier), `leaveCallMode`
  queues behind it on the main thread and switches back off it. The session calls it on every
  ending, and for a dialled conversation only once its `endSession()` has resolved, by which time
  the SDK has stopped LiveKit's session. `call-audio.contract.spec.ts` fails if LiveKit or the SDK
  stops behaving the way that order relies on.
- **That makes this package a native module.** `expo-module.config.json` at its root is what both
  apps' autolinking finds, since both depend on `hologram`. In a build without it,
  `greeting-player.ts` reports the recording as unplayable, and the agent keeps its own first
  message. A browser plays the recording with expo-audio (`greeting-player.web.ts`).
- **And the session connects while he speaks, on every device.** The token is fetched beside him
  and the session is dialled the moment it arrives — while the recording is still being asked
  for, even — muted until he has finished,
  and not at all if he was hung up on. It used to be held back until he had finished on a phone,
  because dialling behind him clipped him there; what clipped him was LiveKit switching into call
  mode a second into the recording, and that switch is now made before he speaks (above), so the
  conversation's start changes nothing he is heard through. Something else did still switch as
  WebRTC opened its microphone: on a phone's speaker the greeting started too loud, caught or cut
  as the conversation connected, and finished at sir's call volume. A call is a call-mode output
  *and* a call's input, and the hardware sets the call up — volume included — only once both are
  open. So `JarvisGreeting`'s `play` first opens the microphone as a call does
  (`CallMicrophone.kt`, `VOICE_COMMUNICATION`, everything it hears dropped) and lets it go when
  the recording ends, is stopped, or the call's audio is let go. Switched first, not dialled
  later, as before. Not yet heard on a device with the fix in.
- **In a browser, only while the microphone is held.** A tab nobody has clicked since it loaded
  refuses to play a sound unless the page is using the microphone, so the phone app's web build
  holds the stream it asked permission with until the session says the greeting has started or
  will not (`onGreetingAnswered`). The session waits for the browser's answer, and if it is no the
  greeting is dropped and the agent keeps its own first message, so he is never left not greeting
  at all.

The session's `user` is the `UserVoice` for the listening lattice. Presence is the latest
`vad_score` (`vad-score.ts`), ignored while he speaks or greets — the firmware's
`speaker_is_active_` rule, since his voice through the speaker scores as the user's — and volume is
the SDK's input level. Both read zero while the session is not connected or its microphone is muted.
The one exception is on a phone and a watch before the agent's first score: the lattice follows the
kept microphone instead (see "What is said while he connects is kept, not lost").
