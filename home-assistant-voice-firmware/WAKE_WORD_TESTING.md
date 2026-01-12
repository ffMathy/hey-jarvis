# Wake Word Testing Guide

This guide helps you test and troubleshoot wake word detection on your Home Assistant Voice firmware.

## Prerequisites

- Firmware flashed to your device (any of the `.yaml` configurations)
- Device connected to Home Assistant
- ESPHome logs access (via Home Assistant or command line)

## Quick Test

1. **Say the wake word** clearly: "Hey Jarvis", "Hey Mycroft", or "Okay Nabu"
2. **Watch for LED feedback**: LEDs should animate when wake word detected
3. **Listen for audio feedback**: Device may play a sound (if wake sound is enabled)
4. **Speak your command**: Device will listen for your voice command

## Detailed Testing Procedure

### 1. Check Device Status

```bash
# View live logs from your device
esphome logs home-assistant-voice.elevenlabs.yaml
```

Look for these log messages:
- `[micro_wake_word] Wake word 'hey_jarvis' detected` ✅
- `[voice_assistant] Starting voice assistant` ✅
- `[micro_wake_word] No wake word detected` ❌ (if you spoke clearly, this indicates an issue)

### 2. Test Each Wake Word

Try each configured wake word in different conditions:

| Wake Word | Test Distance | Background Noise | Expected Result |
|-----------|--------------|------------------|-----------------|
| Hey Jarvis | 1-2 meters | Quiet | Should detect reliably |
| Hey Jarvis | 3-4 meters | Quiet | May require louder voice |
| Hey Jarvis | 1-2 meters | TV/Music | Adjust sensitivity if needed |
| Okay Nabu | 1-2 meters | Quiet | Most reliable (community tested) |
| Hey Mycroft | 1-2 meters | Quiet | Alternative option |

### 3. Adjust Sensitivity

In Home Assistant:
1. Go to your device page
2. Find "Wake word sensitivity" selector
3. Try different levels:
   - **Slightly sensitive**: Fewer false positives (default)
   - **Moderately sensitive**: Balanced
   - **Very sensitive**: More false positives but better detection

### 4. Check Configuration

Verify your wake word configuration has:

✅ **Full model URLs** (ESPHome 2024.7.0+):
```yaml
models:
  - model: https://github.com/esphome/micro-wake-word-models/raw/main/models/v2/hey_jarvis.json
    id: hey_jarvis
```

✅ **VAD configured**:
```yaml
vad:
  model: https://github.com/esphome/micro-wake-word-models/raw/main/models/v2/vad.json
```

❌ **Short names don't work**:
```yaml
models:
  - model: hey_jarvis  # This will NOT work!
```

## Common Issues and Solutions

### Issue: Wake word works once then stops

**Solution 1: Restart the device**
```bash
# Via ESPHome
esphome run home-assistant-voice.elevenlabs.yaml
```

**Solution 2: Toggle use_wake_word switch**
- In Home Assistant, find the device
- Turn off "Use wake word" switch
- Wait 5 seconds
- Turn it back on

### Issue: Wake word never detected

**Check these:**
1. ✅ Microphone is working (check logs for audio input)
2. ✅ Device is not muted (hardware or software switch)
3. ✅ VAD model is configured
4. ✅ Model URLs are complete (not short names)
5. ✅ ESPHome version is 2024.7.0 or later

**Debug commands:**
```bash
# Check ESPHome version
esphome version

# View detailed logs
esphome logs home-assistant-voice.elevenlabs.yaml --verbose

# Validate configuration
esphome config home-assistant-voice.elevenlabs.yaml
```

### Issue: "Hey Jarvis" unreliable

According to community feedback, "Okay Nabu" is the most reliable wake word. Consider switching:

```yaml
# In your configuration, prioritize Okay Nabu
models:
  - model: https://github.com/kahrendt/microWakeWord/releases/download/okay_nabu_20241226.3/okay_nabu.json
    id: okay_nabu
  - model: https://github.com/esphome/micro-wake-word-models/raw/main/models/v2/hey_jarvis.json
    id: hey_jarvis
```

Then in Home Assistant, you can disable Hey Jarvis and use only Okay Nabu.

### Issue: False positives (wakes up randomly)

**Solutions:**
1. Lower sensitivity in Home Assistant
2. Ensure VAD is properly configured
3. Check for interference from other audio sources
4. Increase `gain_factor` if audio is too loud

## Performance Optimization

### Microphone Settings

Adjust in your YAML configuration:
```yaml
micro_wake_word:
  microphone:
    channels: 1
    gain_factor: 4  # Try values 2-8; lower if too sensitive
```

### VAD Settings

Voice Activity Detection filters out non-speech audio:
```yaml
vad:
  model: https://github.com/esphome/micro-wake-word-models/raw/main/models/v2/vad.json
```

If VAD is missing, wake word detection will be unreliable!

## Expected Behavior Timeline

1. **Idle** (0s): Device waiting, LEDs off or dim
2. **Wake word detected** (0.5s): LEDs animate, optional sound plays
3. **Listening** (1-2s): LEDs show "listening" animation
4. **Processing** (3-5s): LEDs show "thinking" animation  
5. **Response** (5-10s): Device speaks response, LEDs show "replying"
6. **Return to idle** (10s): LEDs return to idle state

## Getting Help

If wake word still doesn't work:

1. **Check GitHub issues**: [ESPHome Voice Assistant Issues](https://github.com/esphome/esphome/issues?q=is%3Aissue+micro_wake_word)
2. **Home Assistant Community**: [Voice Assistant Forum](https://community.home-assistant.io/c/voice-assistant/)
3. **ESPHome Discord**: [Join ESPHome Discord](https://discord.gg/KhAMKrd)

## Advanced Debugging

### Enable Debug Logging

Add to your YAML:
```yaml
logger:
  level: DEBUG
  logs:
    micro_wake_word: DEBUG
    voice_assistant: DEBUG
```

### Monitor Audio Levels

Check if microphone is capturing audio:
```yaml
# Add temporary sensor to monitor audio
sensor:
  - platform: adc
    pin: GPIO15  # Your microphone pin
    name: "Microphone Level"
    update_interval: 100ms
```

### Test Without Wake Word

Use push-to-talk mode to verify voice assistant works:
```yaml
voice_assistant:
  use_wake_word: false  # Disable wake word temporarily
```

Then trigger manually from Home Assistant or button press.

## References

- [ESPHome Voice Assistant Documentation](https://esphome.io/components/voice_assistant.html)
- [ESPHome micro_wake_word Documentation](https://esphome.io/components/micro_wake_word.html)
- [Wake Word Model Repository](https://github.com/esphome/micro-wake-word-models)
- [Community Wake Word Database](https://github.com/kahrendt/microWakeWord)
