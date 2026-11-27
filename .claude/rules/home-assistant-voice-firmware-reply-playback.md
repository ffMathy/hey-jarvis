---
paths:
  - "home-assistant-voice-firmware/**"
---

# Playing a Reply

> Part of [Home Assistant Voice Firmware](home-assistant-voice-firmware.md). Paths in it are relative to `home-assistant-voice-firmware/` unless they say otherwise.

ElevenLabs opens every reply with a few 1516-byte frames, 47 ms of audio each, sent more
than 250 ms apart. Only after those does it stream faster than real time. Written straight to
the speaker, those frames play into an empty pipeline and it runs dry between them, so
the first syllables stutter.

So `elevenlabs_stream` holds audio in `reply_prebuffer_` **whenever it would start into an
empty speaker**: every reply, and a reply that ran dry part way. The cushion is released
at `REPLY_PREBUFFER_BYTES` (1.5 s) or after `REPLY_PREBUFFER_MAX_MS` (400 ms), whichever
comes first. Do not arm it only for a conversation's first reply, as it once was: every
later reply then stuttered, three times in one reply of a ten-turn run.

- **The age limit is also enforced by `loop()`.** Audio arrives on the websocket task,
  which only checks the age when another frame comes. Without the check in `loop()`, a
  short reply whose last frame had arrived stayed held until the next reply or the
  hang-up, and was never heard. `reply_prebuffer_lock_` guards the buffer and the writes
  made from it. `loop()` only `try_lock`s it, so the main loop never waits on a speaker write.
- **A reply being held has not played yet.** The speaker callback that turns
  `speaker_is_active_` off 250 ms after the speaker goes quiet ignores the quiet while
  `reply_held_` is set. Otherwise the previous reply's end, or an interrupted reply's,
  ended the new one before it began. That turned the LED back to listening and read as
  an underrun.

The [acoustic e2e](home-assistant-voice-firmware-acoustic-e2e.md) counts an underrun each
time the speaker goes quiet and starts again within one reply. A quiet that an
interruption caused is not counted.
