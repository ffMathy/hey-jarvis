# Home Assistant Voice Firmware

ESPHome firmware for ESP32 voice hardware with local wake word detection and direct ElevenLabs voice streaming.

## Quick Start

```bash
# First flash (USB required)
esphome upload home-assistant-voice.elevenlabs.yaml

# Subsequent updates (WiFi OTA — works in DevContainer)
bunx nx serve home-assistant-voice-firmware

# Build without flashing
bunx nx build home-assistant-voice-firmware
```

## Hardware

- **MCU**: ESP32-S3 (8MB+ flash, 16MB recommended)
- **Audio**: I2S microphone + speaker with AIC3204 DAC
- **LEDs**: 12x WS2812 ring (listening, thinking, idle animations)
- **Input**: Rotary encoder (volume/hue) + center button (single/double/triple/long press)
- **Optional**: Hardware mute switch, 3.5mm jack, Grove connectors

## Configuration Files

| File | Use Case |
|------|----------|
| `home-assistant-voice.yaml` | Full-featured standard build |
| `home-assistant-voice.elevenlabs.yaml` | Direct ElevenLabs integration |
| `home-assistant-voice.8mb.yaml` | Reduced features for 8MB flash |
| `home-assistant-voice.factory.yaml` | Base template for production builds |

## Custom Components

### ElevenLabs Stream (`components/elevenlabs_stream/`)
Real-time bidirectional audio streaming to ElevenLabs via WebSocket. Supports start/stop actions, configurable triggers (listening, processing, replying), and templatable credentials.

### Voice Kit (`components/voice_kit/`)
Hardware DSP abstraction with I2C control, firmware management (DFU with MD5 verification), and audio pipeline stages (AEC, IC, NS, AGC).

## Wake Words

| Word | Notes |
|------|-------|
| Hey Jarvis | Primary |
| Hey Mycroft | Alternative |
| Okay Nabu | Most reliable |

See [WAKE_WORD_TESTING.md](./WAKE_WORD_TESTING.md) for troubleshooting.

## Audio Feedback

18 embedded sound files covering button presses, hardware events (jack, mute), system status (factory reset, errors), wake word confirmation, and easter eggs.

## Grove Modules

- `modules/grove-i2c.yaml` — I2C bus (SDA: GPIO1, SCL: GPIO2)
- `modules/grove-power.yaml` — Port power control (GPIO46)

## Environment

Set via 1Password or manually:

- `HEY_JARVIS_WIFI_SSID` / `HEY_JARVIS_WIFI_PASSWORD`
- `HEY_JARVIS_ELEVENLABS_API_KEY` / `HEY_JARVIS_ELEVENLABS_AGENT_ID`

## Useful Commands

```bash
esphome config home-assistant-voice.elevenlabs.yaml    # Validate config
esphome logs home-assistant-voice.elevenlabs.yaml      # Monitor logs
esphome clean home-assistant-voice.elevenlabs.yaml     # Clean build cache
```

For development guidelines, see [AGENTS.md](./AGENTS.md).
