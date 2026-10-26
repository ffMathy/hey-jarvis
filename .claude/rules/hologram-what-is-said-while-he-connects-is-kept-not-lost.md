---
paths:
  - "hologram/**"
---

# What is said while he connects is kept, not lost

> Part of [Hologram](hologram.md). Paths in it are relative to `hologram/` unless they say otherwise.

The session is dialled behind the greeting, but a token, a room and a handshake can still take
longer than he speaks, and whatever sir started saying between his last word and the agent hearing
anything used to go nowhere. So on a phone and a watch the session holds it (`heldVoice`, which
`useJarvisSession` fills from `conversation/held-voice.ts` on a device only), whenever the
conversation is not yet connected once he has finished:

- **Held from the greeting's end** (`hold`), refused greeting included, by `HeldVoice.kt` in this
  package's native module: an `AudioRecord` of its own, `VOICE_RECOGNITION` rather than the call's
  `VOICE_COMMUNICATION`, which in call mode arrives near -54 dBFS and relies on WebRTC's gain control
  — which what is held never passes through.
- **Played through the conversation's own microphone track**, as LiveKit's capture post-processor.
  On a device the SDK has only WebRTC, and it drops any `user_audio_chunk` handed to it over a room,
  so the track is the only way in. The moment WebRTC opens its microphone the recorder stops, what
  it kept is resampled to WebRTC's rate and queued, and every live frame queues behind it; silence
  is sent meanwhile.
- **Released at the agent's first `vad_score`** (`release`), the sign that it is hearing the track,
  or `RELEASE_HELD_VOICE_AFTER_MS` after connecting if none comes: connected only means the room is
  up, and audio sent before the agent listens is lost a second time.
- **Then sent in order, late, and caught up in the pauses**: each frame sends the front of the
  queue; while behind, any pause past 200 ms is skipped; once the queue is empty the live microphone
  goes straight through. Past twenty seconds behind, what is queued is dropped instead.
- **Dropped on every ending** (`drop`), including one that never connected.
- **The lattice follows it until the agent scores.** No `vad_score` arrives before the agent hears
  the track, so until the first one the session's `user` reads the kept microphone instead:
  `level()`, the RMS of its last 40 ms, as the volume, and `presenceFromMicrophoneLevel`
  (`microphone-presence.ts`) as the presence — a loudness gate in the score's own units, nothing
  at -45 dBFS and sure at -30, so it crosses `HEARING_THRESHOLD` near -41. Not while the keyboard
  is up or he is speaking, as for a score. From the first score on, it is the score again.

The rules — when to hold, release and drop — are the session's, pinned in
`jarvis-session-devices.spec.ts`. The audio itself is the native module's, and no test here runs
it: judge it on a device, by saying something straight after the greeting and checking logcat's
`JarvisHeldVoice` lines (`handing over … ms`, then `caught up`).
