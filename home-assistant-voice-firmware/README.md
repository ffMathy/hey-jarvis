# Home Assistant Voice Firmware

ESPHome-based firmware for dedicated voice hardware devices that provides local voice processing capabilities and seamless integration with the Jarvis ecosystem.

## Overview

This project contains ESPHome configurations and custom components for creating dedicated voice assistant hardware that can run Jarvis locally. It supports various hardware platforms including ESP32-based devices and provides real-time audio processing, wake word detection, and local voice command processing.

## Features

- **Local Voice Processing**: On-device speech recognition and processing
- **Multiple Hardware Configurations**: Support for various ESP32 and voice kit hardware
- **ElevenLabs Integration**: Direct integration with ElevenLabs voice streaming
- **Home Assistant Native**: Deep integration with Home Assistant ecosystem
- **Custom Components**: Specialized voice processing and streaming components
- **Audio Feedback**: Rich audio feedback system with customizable sounds
- **Factory Reset**: Hardware reset capabilities with audio confirmation
- **Grove Modules**: Support for Grove ecosystem sensors and actuators

## Hardware Configurations

### Supported Devices
- **8MB Flash Devices**: Full-featured configuration with all components
- **Factory Devices**: Optimized configuration for mass-produced hardware
- **ElevenLabs Devices**: Specialized configuration for ElevenLabs integration
- **Custom Builds**: Flexible configuration for custom hardware setups

### Required Components
- ESP32 microcontroller (minimum 4MB flash recommended)
- I2S microphone and speaker
- Optional: LED indicators, buttons, Grove connectors
- Power supply (USB or battery-powered options)

## Configuration Files

| File | Description | Use Case |
|------|-------------|----------|
| `home-assistant-voice.yaml` | Standard configuration | General purpose voice device |
| `home-assistant-voice.8mb.yaml` | Full-featured build | Devices with 8MB+ flash memory |
| `home-assistant-voice.elevenlabs.yaml` | ElevenLabs optimized | Direct ElevenLabs integration |
| `home-assistant-voice.factory.yaml` | Production build | Mass production and deployment |

## Quick Start

### Building Firmware

```bash
# Build standard configuration
nx build home-assistant-voice-firmware

# Or build specific configuration
esphome compile home-assistant-voice.elevenlabs.yaml
```

### Flashing Device

```bash
# Flash to connected device
nx serve home-assistant-voice-firmware

# Or flash specific configuration
esphome upload home-assistant-voice.elevenlabs.yaml
```

## Custom Components

### ElevenLabs Stream Component
- Real-time audio streaming to ElevenLabs
- Bidirectional voice communication
- Optimized for low latency
- Located in `components/elevenlabs_stream/`

### Voice Kit Component
- Hardware abstraction for voice processing
- Microphone and speaker management
- Audio routing and mixing
- Located in `components/voice_kit/`

## Audio Assets

The firmware includes a comprehensive audio feedback system:

- **Button Feedback**: Audio confirmation for button presses
- **System Sounds**: Boot, error, and status notifications  
- **Easter Eggs**: Fun interactive audio responses
- **Error Handling**: Specific audio feedback for different error states

All audio files are located in the `sounds/` directory and are automatically embedded in the firmware.

## Grove Module Support

Pre-configured support for Grove ecosystem modules:

- **I2C Modules**: `modules/grove-i2c.yaml`
- **Power Management**: `modules/grove-power.yaml`

These modules can be included in your configuration for additional sensors and actuators.

## Development

### Prerequisites
- ESPHome installed (`pip install esphome`)
- Compatible ESP32 development board
- Audio hardware (microphone and speaker)

### Configuration

1. Copy one of the base configurations
2. Modify WiFi credentials and Home Assistant settings
3. Adjust hardware pin assignments as needed
4. Add any additional components or sensors

### Testing

```bash
# Validate configuration
esphome config home-assistant-voice.yaml

# Monitor device logs
esphome logs home-assistant-voice.yaml
```

## Integration

The voice firmware integrates with:

- **Home Assistant Core**: Device registration and entity management
- **Jarvis MCP Server**: Voice command processing and AI agent communication
- **ElevenLabs**: Direct voice streaming and processing
- **Home Assistant Addon**: Centralized management and configuration

## Network Architecture

```
Voice Hardware → Home Assistant → Home Assistant Addon → Jarvis MCP Server → ElevenLabs
```

The firmware communicates with Home Assistant, which routes voice commands through the addon to the MCP server for processing.

## Troubleshooting

### Common Issues

- **Flash Memory**: Use 8MB configuration for full features
- **Audio Quality**: Check I2S pin assignments and sample rates
- **Network**: Ensure stable WiFi connection for cloud features
- **Power**: Use adequate power supply for stable operation

### Debug Commands

```bash
# View detailed logs
esphome logs home-assistant-voice.yaml --verbose

# Check configuration syntax
esphome config home-assistant-voice.yaml

# Clean build cache
esphome clean home-assistant-voice.yaml
```

## YAGNI Development Principles

This project follows YAGNI (You Aren't Gonna Need It) principles:

- **Hardware Abstraction**: Only abstract when supporting multiple platforms
- **Protocol Support**: Implement communication protocols as needed
- **Memory Management**: Keep allocation simple until optimization required
- **Feature Flags**: Avoid configuration for unimplemented features
- **Libraries**: Include only necessary ESPHome components

For detailed development guidelines, see [AGENTS.md](./AGENTS.md).

## Future Enhancements

- **On-device Wake Word**: Local wake word detection without cloud dependency
- **Edge AI Processing**: Local AI inference for common commands
- **Mesh Networking**: Multi-device coordination and communication
- **Advanced Audio**: Noise cancellation and echo suppression
- **Battery Optimization**: Power management for portable devices

## Contributing

- Follow ESPHome best practices and conventions
- Test configurations on actual hardware before committing
- Use NX build commands for consistency with monorepo
- Document any new custom components thoroughly
- Update this README when adding new configurations or features