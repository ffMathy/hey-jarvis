---
paths:
  - "mobile/**"
---

# He greets you before he is connected

> Part of [Mobile App → The hologram](mobile-the-hologram.md). Paths in it are relative to `mobile/` unless they say otherwise.

The moment the microphone is granted, "Hello sir, how can I help?" plays from the firmware's own
recording and the token request goes out beside it, so by the time he has asked, the session is
usually up. The session is opened with the agent's first message switched off and its microphone
muted until the recording ends; if it is slower than that, the screen goes on connecting exactly as
before, under the same `GIVE_UP_CONNECTING_AFTER_MS`. Hanging up mid-greeting stops it. How it
works, and the ways to break it, are in `.claude/rules/hologram-summoned-he-greets-you-before-he-is-connected.md` ("Summoned, he greets you before he is
connected"): the session does all of it.

Two places it deliberately does not play. **The text-only session**, a browser that refused the
microphone: that was a choice to keep the conversation quiet, so he greets in writing there — the
agent keeps its first message, and it arrives as his first written reply. **A browser that refuses
the sound anyway**, in which case the agent keeps its first message too, so he is never left not
greeting at all.

A browser tab nobody has clicked since it loaded — a reload straight onto the conversation, or a
new tab — is not one of those, though it used to be. Browsers refuse to start a sound there *unless
the page is using the microphone*, so `microphone-permission.web.ts` holds the stream it asks
permission with until the greeting has started, and lets it go straight after. Released at once, as
it once was, the recording was refused and the agent greeted in its own voice instead.

**On a phone he greets as call audio, and the session connects behind him.** All of it was learned on a
device. Dialled behind him, `startSession` started LiveKit's audio session — the SDK's
`communication` preset, `MODE_IN_COMMUNICATION` — a second into "Hello sir", and the recording
turned thin and clipped from there. Held back until he had finished, he was not heard at all:
played by expo-audio, as media, the recording was not heard on its own. Starting the call's audio
session before him and still playing him as media was tested next, and was silent too. So on a
phone and a watch he is no longer played by expo-audio at all. The session starts the call's audio
session first (`hologram/src/conversation/call-audio.ts`) and plays the recording through
`hologram`'s own native module, `JarvisGreeting`, with `USAGE_VOICE_COMMUNICATION` — as the call's own
audio, on the speaker, at call volume. The token is fetched beside him, and the session was dialled
only once he had finished — until the user asked for it to connect while he greets. With call mode
already in force before he speaks, the switch that clipped him is not made mid-greeting any more,
so the session is now dialled behind him, as in a browser, muted until he has finished. A browser
plays it with expo-audio. WebRTC opening its microphone behind him was a second switch — the call
is only fully set up once a call's input is open too, so the greeting started loud and caught as
the conversation connected — and `hologram`'s `CallMicrophone` now opens that input before he
speaks (see `.claude/rules/hologram.md`).
Still to settle on a device: that he is heard this way, and that `vad_score` events arrive over
WebRTC as they do over the firmware's socket.

The sphere also shows the user being heard: while ElevenLabs' `vad_score` says someone is
speaking, his particles snap onto a lattice that turns inside him, breathing harder the louder the
microphone is. The session's `user` feeds it, and it ignores the score while Jarvis speaks, since
the microphone hears him too.
