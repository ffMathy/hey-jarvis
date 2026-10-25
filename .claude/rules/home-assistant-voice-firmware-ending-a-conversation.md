---
paths:
  - "home-assistant-voice-firmware/**"
---

# Ending a Conversation

> Part of [Home Assistant Voice Firmware](home-assistant-voice-firmware.md). Paths in it are relative to `home-assistant-voice-firmware/` unless they say otherwise.

The `elevenlabs_stream` component (`components/elevenlabs_stream/`) hangs up on its own
in two cases. Each ends through `stop_stream()`, so `on_end` fires, the wake word
restarts and the LEDs go idle:

- **`end_call`** — the agent's system tool, received as an `agent_tool_response`. The
  device waits for the farewell to finish playing first. This is also how a finished
  request hangs up: the agent's `turnTimeout` prompts Jarvis after 3 s of silence, and
  he calls `end_call` without a word. The device keeps no clock of its own for it.
- **Announcement window** — `announce` starts a stream with a `timeout`, and a quiet
  window hangs up if nobody answers. Speech (`vad_score` ≥ 0.5) only pushes that clock
  back, and the first transcript drops it. After that the conversation behaves like a
  wake-word one.

The announcement window is timed on the device because ElevenLabs'
`silence_end_call_timeout` is not an overridable setting.
