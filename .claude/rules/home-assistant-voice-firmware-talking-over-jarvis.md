---
paths:
  - "home-assistant-voice-firmware/**"
---

# Talking over Jarvis

> Part of [Home Assistant Voice Firmware](home-assistant-voice-firmware.md). Paths in it are relative to `home-assistant-voice-firmware/` unless they say otherwise.

The `elevenlabs_stream` component keeps the microphone open while Jarvis speaks. The XMOS
front end cancels the speaker's echo, using the audio the ESP32 sends it as the
reference, so his own voice does not come back as the user's.

**Never shut the microphone while the speaker plays.** The agent's turn detection starts
a reply after a complete sentence, even with `patient` eagerness, and expects the user
carrying on to interrupt it. With the mic shut, the rest of the turn never arrived:
"Make it about six sentences long" reached the agent as "make sentences longer", and the
question after "Interesting." was lost while Jarvis talked over it.

A gate can hide in an innocent-looking check. `activation_speaker_->has_buffered_data()`
looked like "the chime is playing", but a resampler speaker counts its output speaker's
buffer as its own, and both resamplers feed one i2s speaker. So it was true whenever
Jarvis spoke, and it kept losing the user's words after `speaker_is_active_` stopped
shutting the mic.

## Keeping his own voice out

Only channel 0 of the XMOS front end's two is sent: the one `voice_assistant` sends for
speech-to-text. With both channels averaged and the mic open, the tails of five of
eight replies interrupted Jarvis with nobody speaking. With channel 0 alone, none did.

The conversation's first line is the exception, so the mic is shut while it plays
(`opening_line_done_`). The front end does not cancel it: in three runs out of three,
the greeting came back as the user's turn ("Hello, Sam. How can I help?") and Jarvis
answered himself, though no later reply leaked. It is spoken before the user has a
turn, so shutting the mic for it loses nothing.

## When the agent is interrupted

ElevenLabs sends `interruption` with an `event_id` and nothing else. The reply's audio is
already queued in the speaker's 60 s buffer, or still arriving. `stop_interrupted_reply_`:

- stops the speaker, its only way to discard what is queued. The next reply restarts it
  and gets a fresh prebuffer;
- records the `event_id`. Audio carrying that id or an earlier one is dropped as it
  arrives. The fast path reads `event_id` by scanning, like the payload;
- turns `speaker_is_active_` off, so the LED and the VAD guard see Jarvis as quiet.

Event ids count up from each conversation's start, so `start_stream` resets the one it
records.
