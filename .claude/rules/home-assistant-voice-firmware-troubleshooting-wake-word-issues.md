---
paths:
  - "home-assistant-voice-firmware/**"
---

# Troubleshooting Wake Word Issues

> Part of [Home Assistant Voice Firmware](home-assistant-voice-firmware.md). Paths in it are relative to `home-assistant-voice-firmware/` unless they say otherwise.

## Wake Word Not Detecting
1. **Check ESPHome Version**: The firmware needs ESPHome 2026.10.0 or later (see [ESPHome Version](home-assistant-voice-firmware-development.md#esphome-version))
2. **Verify Model URLs**: All models must use full GitHub URLs (see above)
3. **Enable VAD**: Voice Activity Detection must be configured
4. **Check Logs**: Monitor ESPHome logs for "wake word detected" messages
5. **Test Microphone**: Verify audio input is working (check gain_factor setting)
6. **Adjust Sensitivity**: Use the "Wake word sensitivity" selector in Home Assistant

## Common Issues
- **Works once then stops**: Try restarting the device or toggling the use_wake_word switch
- **Hey Jarvis unreliable**: Consider switching to "Okay Nabu" (reported as more reliable)
- **No response after wake word**: Check that voice_assistant is properly connected to Home Assistant

## Debug Commands
```bash
# View device logs
bunx turbo serve --filter=home-assistant-voice-firmware

# Or directly with ESPHome
esphome logs home-assistant-voice.elevenlabs.yaml --verbose

# Validate configuration
esphome config home-assistant-voice.elevenlabs.yaml
```
