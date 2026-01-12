# Home Assistant Voice Firmware

> **Note:** See the root [AGENTS.md](../AGENTS.md) for shared conventions (NX commands, commit standards, 1Password, etc.)

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

## Wake Word Configuration

### Supported Wake Words
The firmware supports multiple wake words configured in `micro_wake_word:` section:
- **Hey Jarvis**: Primary wake word for this project
- **Hey Mycroft**: Alternative wake word
- **Okay Nabu**: Most reliable wake word according to community feedback
- **Stop**: Special wake word for timer control (internal use)

### Important Configuration Notes
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

### Voice Activity Detection (VAD)
VAD is critical for wake word reliability. Always configure the VAD model:
```yaml
vad:
  model: https://github.com/esphome/micro-wake-word-models/raw/main/models/v2/vad.json
```

## Troubleshooting Wake Word Issues

### Wake Word Not Detecting
1. **Check ESPHome Version**: Ensure you're using ESPHome 2024.7.0 or later
2. **Verify Model URLs**: All models must use full GitHub URLs (see above)
3. **Enable VAD**: Voice Activity Detection must be configured
4. **Check Logs**: Monitor ESPHome logs for "wake word detected" messages
5. **Test Microphone**: Verify audio input is working (check gain_factor setting)
6. **Adjust Sensitivity**: Use the "Wake word sensitivity" selector in Home Assistant

### Common Issues
- **Works once then stops**: Try restarting the device or toggling the use_wake_word switch
- **Hey Jarvis unreliable**: Consider switching to "Okay Nabu" (reported as more reliable)
- **No response after wake word**: Check that voice_assistant is properly connected to Home Assistant

### Debug Commands
```bash
# View device logs
bunx nx serve home-assistant-voice-firmware

# Or directly with ESPHome
esphome logs home-assistant-voice.elevenlabs.yaml --verbose

# Validate configuration
esphome config home-assistant-voice.elevenlabs.yaml
```

## Usage
```bash
# Build the firmware
bunx nx build home-assistant-voice-firmware

# Flash and monitor (OTA or USB)
bunx nx serve home-assistant-voice-firmware
```

## Development

### Build System
The firmware uses ESPHome with NX monorepo conventions. Configuration files:
- `home-assistant-voice.yaml`: Standard configuration with all wake words
- `home-assistant-voice.elevenlabs.yaml`: ElevenLabs-optimized configuration
- `home-assistant-voice.8mb.yaml`: Full-featured build for 8MB+ flash
- `home-assistant-voice.factory.yaml`: Production build

### Configuration Files
Each YAML file configures:
- Hardware pins and I2S audio
- Wake word models and VAD
- Voice assistant integration
- LED animations and feedback
- Audio files and sounds

### Firmware-Specific YAGNI Guidelines
Apply YAGNI to embedded systems development:
- **Hardware Abstraction**: Only abstract when supporting multiple platforms
- **Protocol Support**: Don't implement protocols until needed
- **Memory Management**: Keep simple until optimization is required
- **Feature Flags**: Avoid options for unimplemented features
- **Wake Word Models**: Only include models you'll actually use

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