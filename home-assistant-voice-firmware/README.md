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

#### Initial Flash (USB)
For the first firmware upload, connect the device via USB:

```bash
# Flash to USB-connected device
esphome upload home-assistant-voice.elevenlabs.yaml
```

#### Over-the-Air (OTA) Updates via WiFi

After the initial flash, the firmware can be updated wirelessly over WiFi. **This is fully supported inside the DevContainer** thanks to host network mode:

```bash
# Deploy firmware updates over WiFi
nx serve home-assistant-voice-firmware

# Or directly with ESPHome
esphome run home-assistant-voice.elevenlabs.yaml
```

The ESPHome `run` command will:
1. Compile the firmware
2. Automatically discover the device on your network via mDNS
3. Upload the firmware wirelessly
4. Show real-time logs from the device

**Requirements for OTA:**
- Device must have been flashed at least once with USB
- Device must be connected to the same WiFi network (configured via `HEY_JARVIS_WIFI_SSID` and `HEY_JARVIS_WIFI_PASSWORD` environment variables)
- DevContainer must have host network access (already configured)

**Note:** The DevContainer is configured with `--network=host` to enable mDNS discovery and OTA uploads without any additional setup.

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

#### Using DevContainer (Recommended)
The repository includes a fully configured DevContainer with all dependencies pre-installed:
- ESPHome is automatically installed during DevContainer initialization
- Host network mode enabled for WiFi OTA deployment
- Device access configured for USB flashing
- All environment variables passed through from host

Simply open the project in VS Code with the Dev Containers extension, and everything will be ready.

#### Manual Setup
If not using DevContainer:
- ESPHome installed (`pip install esphome`)
- Compatible ESP32 development board
- Audio hardware (microphone and speaker)
- Network access for OTA deployment

### Configuration

1. Set required environment variables:
   ```bash
   export HEY_JARVIS_WIFI_SSID="your-wifi-name"
   export HEY_JARVIS_WIFI_PASSWORD="your-wifi-password"
   export HEY_JARVIS_ELEVENLABS_API_KEY="your-api-key"
   export HEY_JARVIS_ELEVENLABS_AGENT_ID="your-agent-id"
   ```

2. Choose a base configuration (e.g., `home-assistant-voice.elevenlabs.yaml`)
3. Modify hardware-specific settings if needed
4. Adjust pin assignments for your specific board

### Testing

```bash
# Validate configuration
esphome config home-assistant-voice.elevenlabs.yaml

# Monitor device logs (works over WiFi)
esphome logs home-assistant-voice.elevenlabs.yaml
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