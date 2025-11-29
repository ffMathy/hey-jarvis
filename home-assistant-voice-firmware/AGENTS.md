# Home Assistant Voice Firmware

> **Note:** See the root [AGENTS.md](../AGENTS.md) for shared conventions (NX commands, commit standards, 1Password, etc.)

## Overview
ESPHome firmware for dedicated voice hardware devices with local processing capabilities.

## Project Description
A simple Hello World C++ application that demonstrates basic firmware structure and serves as a foundation for future voice processing and home automation integration.

## Key Features
- Simple C++ "Hello World" application
- Cross-platform compilation support
- Foundation for embedded systems and IoT device integration

## Hardware Integration
Designed to be compatible with:
- Raspberry Pi and similar SBCs
- ESP32/Arduino microcontrollers
- Voice processing hardware
- Home automation devices

## Usage
```bash
# Build the firmware
bunx nx build home-assistant-voice-firmware

# Run the firmware
bunx nx serve home-assistant-voice-firmware
```

## Development

### Build System
The firmware is built using C++17 and follows NX monorepo conventions. All source code is located in the `src/` directory.

### Firmware-Specific YAGNI Guidelines
Apply YAGNI to embedded systems development:
- **Hardware Abstraction**: Only abstract when supporting multiple platforms
- **Protocol Support**: Don't implement protocols until needed
- **Memory Management**: Keep simple until optimization is required
- **Feature Flags**: Avoid options for unimplemented features

## Future Capabilities
- Voice command processing and recognition
- Home Assistant integration for smart home control
- Real-time audio processing
- Device communication protocols
- Embedded systems deployment

## Scope Guidelines for Commits
Use firmware-specific scopes:
- `firmware`, `audio`, `hardware`
- `voice`, `processing`