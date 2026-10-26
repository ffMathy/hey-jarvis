---
paths:
  - "home-assistant-voice-firmware/**"
---

# Development

> Part of [Home Assistant Voice Firmware](home-assistant-voice-firmware.md). Paths in it are relative to `home-assistant-voice-firmware/` unless they say otherwise.

## Build System
The firmware uses ESPHome with Turborepo monorepo conventions. Configuration files:
- `home-assistant-voice.yaml`: Standard configuration with all wake words
- `home-assistant-voice.elevenlabs.yaml`: ElevenLabs-optimized configuration
- `home-assistant-voice.8mb.yaml`: Full-featured build for 8MB+ flash
- `home-assistant-voice.factory.yaml`: Production build

## ESPHome Version
The firmware needs **ESPHome 2026.10.0 or later**. `esphome.min_version` in
`home-assistant-voice.elevenlabs.yaml` enforces it, and no older release can build it.

ESPHome 2026.10.0 (esphome/esphome#20072) keeps audio files in flash. As a result, every
`media_player.files` id is now a `const audio::AudioFile *`, and that is also the type
`play_file` takes. The `play_sound` script receives a file as a parameter, so its
`sound_file` parameter is a pointer to const as well. ESPHome rejects a parameter type
that contains a space, so `const` cannot be written out. The type is spelled
`std::add_pointer_t<std::add_const_t<audio::AudioFile>>` instead. Do not loosen it back
to `audio::AudioFile*`, which breaks every call site, and do not reach for `const_cast`.

`initialize` (which `build` depends on) reads that `min_version`. It upgrades an
installed ESPHome that is older and installs the latest release when none is present.
Neither CI nor the setup scripts pin ESPHome, so a new release can break the build with
no change in this repository, as 2026.10.0 did. When a fix relies on a newer ESPHome,
raise `min_version` in the same change.

## Configuration Files
Each YAML file configures:
- Hardware pins and I2S audio
- Wake word models and VAD
- Voice assistant integration
- LED animations and feedback
- Audio files and sounds

## Firmware-Specific YAGNI Guidelines
Apply YAGNI to embedded systems development:
- **Hardware Abstraction**: Only abstract when supporting multiple platforms
- **Protocol Support**: Don't implement protocols until needed
- **Memory Management**: Keep simple until optimization is required
- **Feature Flags**: Avoid options for unimplemented features
- **Wake Word Models**: Only include models you'll actually use
