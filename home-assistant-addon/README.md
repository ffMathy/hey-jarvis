# Home Assistant Addon

A Home Assistant addon that seamlessly hosts the Jarvis MCP server within your Home Assistant instance, providing intelligent voice assistant capabilities directly integrated with your smart home.

## Overview

This Node.js Express application serves as a Home Assistant addon, allowing you to run the Jarvis MCP server as a native addon within your Home Assistant OS or Supervised installation. It provides a bridge between Home Assistant's ecosystem and the intelligent capabilities of the Jarvis AI agents.

## Features

- **Native Home Assistant Integration**: Runs as a standard Home Assistant addon
- **MCP Server Hosting**: Hosts the Jarvis MCP server within Home Assistant
- **Docker Support**: Containerized deployment with proper Home Assistant integration
- **Configuration UI**: Web-based configuration interface for addon settings
- **Health Monitoring**: Built-in health checks and status monitoring
- **Secure Communication**: Encrypted communication between components

## Installation

### Via Home Assistant

1. Add this repository to your Home Assistant addon store
2. Install the "Jarvis MCP Server" addon
3. Configure the addon settings through the UI
4. Start the addon

### Manual Installation

```bash
# Build the addon
nx build home-assistant-addon

# Or serve for development
nx serve home-assistant-addon
```

## Configuration

The addon accepts the following configuration options:

- **API Keys**: ElevenLabs, OpenWeatherMap, and other service credentials
- **Port**: Server port (default: 8099)
- **Log Level**: Logging verbosity
- **MCP Settings**: Model Context Protocol server configuration

## Usage

Once installed and configured:

1. The addon will automatically start the Jarvis MCP server
2. ElevenLabs conversational agents can connect to the MCP server
3. Voice commands will be processed through Home Assistant
4. Smart home devices can be controlled via voice interactions

## Architecture

```
ElevenLabs Agent → Home Assistant Addon → Jarvis MCP Server → Home Assistant Devices
```

The addon serves as the central hub, receiving requests from ElevenLabs and executing them through the Jarvis MCP server, which can then control Home Assistant devices and services.

## Development

```bash
# Start development server
nx serve home-assistant-addon

# Build for production
nx build home-assistant-addon

# View logs
docker logs home-assistant-addon
```

## Integration

This addon integrates with:
- **ElevenLabs**: Receives voice commands from conversational agents
- **Jarvis MCP Server**: Executes intelligent tool operations
- **Home Assistant Core**: Controls devices and services
- **Voice Hardware**: Communicates with dedicated voice devices

For more information on the complete Jarvis ecosystem, see the main [README](../README.md).