---
paths:
  - "home-assistant-voice-firmware/**"
---

# Acoustic End-to-End Test

> Part of [Home Assistant Voice Firmware](home-assistant-voice-firmware.md). Paths in it are relative to `home-assistant-voice-firmware/` unless they say otherwise.

`.scripts/wake-word-e2e.sh` tests the real device over real air: it plays "Hey Jarvis"
through the host speakers, then holds a multi-turn conversation. It records each reply
from the room and has Gemini compare the recording with ElevenLabs' own audio of the
same call. It needs ElevenLabs and Gemini keys, a USB-attached device for the serial
log, and the host volume up.

```bash
bunx turbo wake-word-test --filter=home-assistant-voice-firmware
```

The default conversation has six turns and ends with a goodbye that should make the agent
call `end_call`. Set `COMMAND_TEXT` for a single turn, or `TURNS_FILE` for your own turns.
Exit codes: `1` never woke, `2` playback defects or device instability (crash, speaker
stall, allocation failure), `3` the comparison could not run, `4` the call ended or a
reply never came before the last turn, `5` the agent replied while a turn was still
playing.

Exit `5` is the agent's turn detection, not the firmware. The mic is shut while the
speaker plays, so once the agent cuts in at a pause the rest of that turn is lost, and
the next reply answers half a sentence. Fix it in the agent's turn settings (see
[Hanging up when he goes quiet](elevenlabs-hanging-up-when-he-goes-quiet.md)), not on the device.

`WAKE_VIA=api DEVICE_HOST=<ip>` starts the call through the device's
`start_conversation` action instead of the spoken wake phrase. Use it to test the
conversation when the synthesised "Hey Jarvis" does not wake the device: through the
host speakers it peaks around 0.7–0.8 against the 0.92 cutoff, while a real voice
wakes it.

The test plays a turn only once Jarvis is done: the speaker must be off and no reply
audio must have arrived for `REPLY_SETTLE_MS` (2.5 s). That has to stay well under the
agent's 7 s `turnTimeout`, or Jarvis speaks again, onto the closed mic, as the turn starts.
