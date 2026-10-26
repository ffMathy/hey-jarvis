---
paths:
  - "home-assistant-voice-firmware/**"
---

# Home Assistant Voice Firmware

> Paths in this rule are relative to `home-assistant-voice-firmware/` unless they say otherwise.

## Its rules

Each topic is a rule of its own, under the same paths:

- [Ending a Conversation](home-assistant-voice-firmware-ending-a-conversation.md)
- [Wake Word Configuration](home-assistant-voice-firmware-wake-word-configuration.md)
- [Troubleshooting Wake Word Issues](home-assistant-voice-firmware-troubleshooting-wake-word-issues.md)
- [Development](home-assistant-voice-firmware-development.md)

## Overview
ESPHome firmware for dedicated voice hardware devices with local processing capabilities.

## Project Description
ESPHome-based firmware for ESP32-S3 voice assistant hardware that provides local wake word detection, voice command processing, and integration with Home Assistant and ElevenLabs.

## Key Features
- Local wake word detection using micro_wake_word
- Multiple wake word support (Hey Jarvis, Hey Mycroft, Okay Nabu)
- Voice Activity Detection (VAD) for improved accuracy
- ElevenLabs integration for conversational AI
- LED animations for visual feedback
- Audio feedback system with customizable sounds

## Hardware Integration
Designed to be compatible with:
- ESP32-S3 microcontrollers with PSRAM
- I2S microphone and speaker hardware
- LED ring indicators
- Voice processing hardware
- Home Assistant ecosystem

## MCP Tool Calls

The speaker shares its agent with the apps, and the agent's client events include
`mcp_tool_call` for them — the phone, the watch and the headset show Jarvis thinking
while one runs — so the speaker is sent every MCP tool call too. It has no use for
them, and it logs each at DEBUG by tool name and state only, never in full: a result
can carry an email summary or a calendar entry, and the unknown-type fallback would
have logged all of it at WARN.

## Usage
```bash
# Build the firmware
bunx turbo build --filter=home-assistant-voice-firmware

# Flash and monitor (OTA or USB)
bunx turbo serve --filter=home-assistant-voice-firmware
```

## Testing

### Manual Testing
1. Flash firmware to device
2. Monitor logs for wake word detection
3. Test each configured wake word
4. Verify LED and audio feedback
5. Test voice assistant integration

### Automated Testing
Currently no automated tests exist for wake word detection. Manual testing on physical hardware is required.

## Future Capabilities
- Additional wake word models
- Custom wake word training
- Improved noise cancellation
- Battery-powered operation
- Mesh networking between devices

## Scope Guidelines for Commits
Use firmware-specific scopes:
- `firmware`: Firmware configuration changes
- `wake-word`: Wake word and voice detection
- `audio`: Audio processing and feedback
- `hardware`: Hardware configuration and pins
- `voice`: Voice assistant integration
