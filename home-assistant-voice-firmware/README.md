# Home Assistant Voice Firmware

ESPHome firmware for ESP32 voice hardware with local wake word detection and direct ElevenLabs voice streaming.

## Quick Start

```bash
# First flash (USB required)
esphome upload home-assistant-voice.elevenlabs.yaml

# Subsequent updates (WiFi OTA — works in DevContainer)
bunx turbo serve --filter=home-assistant-voice-firmware

# Build without flashing
bunx turbo build --filter=home-assistant-voice-firmware
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

## Registering in Home Assistant

Use `home-assistant-voice.elevenlabs.yaml` for this. It is the build that talks to the Jarvis agent
and the only one that exposes the announce service below — the standard build has neither.

### Adding the device

Once the device is on WiFi, ESPHome advertises itself over mDNS and Home Assistant discovers it:
**Settings → Devices & Services**, find it under *Discovered*, then **Configure → Submit**. If it
does not appear, add the **ESPHome** integration manually with the device's IP address (or
`hass-elevenlabs-<suffix>.local`) on port `6053`.

No encryption key is required — the `api:` block in this build has no `encryption:` key, unlike the
standard build. Being asked for one means a different device is being added.

**The device name is not the one in the YAML.** `name_add_mac_suffix: true` appends part of the MAC
address, so `hass-elevenlabs` becomes something like `hass-elevenlabs-a1b2c3` on the network. Read
the real name off the device page in Home Assistant before calling anything on it.

### Sending it a message

The firmware registers an `announce` action. From **Developer Tools → Actions** in YAML mode:

```yaml
action: esphome.hass_elevenlabs_a1b2c3_announce
data:
  message: "Your laundry is finished."
  silence_seconds: 3
```

Replace `a1b2c3` with the device's own suffix; hyphens in the device name become underscores in the
action name.

The device speaks the message and then stays in a live conversation, microphone open, until the user
has been silent for `silence_seconds`. Answering continues it as an ordinary conversation; saying
nothing lets it close itself. It therefore exercises the whole path — device, agent, and MCP tools —
rather than only playing audio.

`silence_seconds` falls back to 3 seconds when it is `0` or omitted, deliberately: without it an
announcement inherits the agent's 30-second default and waits with the microphone open.

### Playing audio without the agent

The device also exposes a `media_player` entity, so `tts.speak` or `media_player.play_media` aimed at
it plays audio without starting a conversation. Useful for telling "the speaker is broken" apart from
"the agent is not answering".

### Troubleshooting

| Symptom | Cause |
| --- | --- |
| Action succeeds, device stays silent | The mute switch is on. Announcements are suppressed while muted, and the log line is `Announcement suppressed: the device is muted` — no error is raised. |
| The action does not exist in Home Assistant | Either the standard firmware is flashed instead of the ElevenLabs build, or the MAC suffix in the action name is wrong. |
| Device never appears for discovery | mDNS does not cross subnets or most VLANs; add the integration by IP instead. |

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
