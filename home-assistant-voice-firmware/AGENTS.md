# Home Assistant Voice Firmware Agents

## Overview
This document describes the agents and automation capabilities for the Home Assistant Voice Firmware project in the Hey Jarvis monorepo.

## Project Description
A simple Hello World C++ application that demonstrates basic firmware structure and serves as a foundation for future voice processing and home automation integration.

## Key Features
- Simple C++ "Hello World" application
- Demonstrates basic class structure and execution flow
- Cross-platform compilation support
- Foundation for embedded systems and IoT device integration

## Agents & Automation
Currently implements:
- **HelloWorldApp**: A basic firmware agent that demonstrates greeting functionality
- Simple console output and execution flow
- C++ standard library utilization

## Future Capabilities
- Voice command processing and recognition
- Home Assistant integration for smart home control
- Real-time audio processing
- Device communication protocols
- Embedded systems deployment

## Hardware Integration
Designed to be compatible with:
- Raspberry Pi and similar SBCs
- ESP32/Arduino microcontrollers
- Voice processing hardware
- Home automation devices

## Usage
```bash
# Build the firmware
npx nx build home-assistant-voice-firmware

# Run the firmware
npx nx serve home-assistant-voice-firmware
```

## Development Commands
**CRITICAL: ALWAYS use NX commands** for this monorepo:
- ✅ Use `nx serve home-assistant-voice-firmware` instead of `npm run dev`
- ✅ Use `nx build home-assistant-voice-firmware` instead of `npm run build`
- ✅ Use `nx test home-assistant-voice-firmware` instead of `npm run test`
- ✅ Use `nx lint home-assistant-voice-firmware` instead of `npm run lint`
- ❌ **NEVER use `npm run` commands** in this NX monorepo
- ❌ **NEVER use `npm install` directly** - use NX workspace commands

## Development Guidelines

### Core Development Principles

#### 🎯 **YAGNI (You Aren't Gonna Need It)**
Apply YAGNI principle to firmware and embedded systems development:
- **Hardware Abstraction**: Only abstract hardware interfaces when supporting multiple platforms
- **Protocol Support**: Don't implement communication protocols until they're needed
- **Memory Management**: Keep memory allocation simple until optimization is required
- **Feature Flags**: Avoid configuration options for features that aren't implemented yet
- **Libraries**: Don't include libraries until they solve a specific problem

## Development
The firmware is built using C++17 and follows NX monorepo conventions. All source code is located in the `src/` directory. The build system uses g++ for compilation.