---
paths:
  - "home-assistant-voice-firmware/**"
---

# Wake Word Configuration

> Part of [Home Assistant Voice Firmware](home-assistant-voice-firmware.md). Paths in it are relative to `home-assistant-voice-firmware/` unless they say otherwise.

## Supported Wake Words
The firmware supports multiple wake words configured in `micro_wake_word:` section:
- **Hey Jarvis**: Primary wake word for this project
- **Hey Mycroft**: Alternative wake word
- **Okay Nabu**: Most reliable wake word according to community feedback
- **Stop**: Special wake word for timer control (internal use)

## Important Configuration Notes
**ESPHome 2024.7.0+ Breaking Change**: Wake word models must use full GitHub URLs, not short names.

✅ **Correct:**
```yaml
models:
  - model: https://github.com/esphome/micro-wake-word-models/raw/main/models/v2/hey_jarvis.json
    id: hey_jarvis
```

❌ **Incorrect (will not work):**
```yaml
models:
  - model: hey_jarvis
    id: hey_jarvis
```

## Voice Activity Detection (VAD)
VAD is critical for wake word reliability. Always configure the VAD model:
```yaml
vad:
  model: https://github.com/esphome/micro-wake-word-models/raw/main/models/v2/vad.json
```
