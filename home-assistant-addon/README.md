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
# Hey Jarvis Home Assistant Addon

Bring AI-powered voice assistant capabilities directly into your Home Assistant installation with intelligent agents for weather, shopping, cooking, and more.

## What is This?

This Home Assistant addon hosts the Jarvis MCP (Model Context Protocol) server within your Home Assistant instance, providing:

- **AI Agents**: Weather forecasting, shopping list management, recipe search, and meal planning
- **Voice Integration**: Ready to connect with ElevenLabs conversational AI or Home Assistant voice
- **Smart Home Control**: Seamless integration with your Home Assistant devices and automations
- **Web Interface**: Interactive playground to test and manage agents

## Quick Start

### Installation

**Method 1: Add-on Store (Recommended)**
1. Open Home Assistant → **Supervisor** → **Add-on Store**
2. Click **⋮** (three dots) → **Repositories**
3. Add: `https://github.com/ffMathy/hey-jarvis`
4. Find "Hey Jarvis MCP Server" and click **Install**

**Method 2: Local Development**
1. Copy `home-assistant-addon/` to `addons/local/` in Home Assistant
2. Restart Home Assistant
3. Go to **Supervisor** → **Add-on Store** → **Local Add-ons**
4. Install "Hey Jarvis MCP Server"

### Usage

1. Click **Start** in the addon configuration
2. Click **Open Web UI** to access the Mastra playground
3. Test agents interactively at `http://[host]:4111/agents`
4. Integrate with voice assistants for voice control

## Features

### Available AI Agents

- **Weather Agent**: Get forecasts and weather conditions with smart location defaults
- **Shopping Agent**: Manage Bilka shopping lists with Danish language support
- **Recipe Agent**: Search Danish recipes from Valdemarsro
- **Meal Planning**: Generate weekly meal plans with shopping lists

### Technical Highlights

- **Multi-architecture Support**: Works on AMD64, ARMv7, and AArch64 systems
- **Secure Integration**: Uses Home Assistant ingress for protected web access
- **Persistent Memory**: Agents remember context across conversations
- **Real-time Streaming**: See AI responses as they're generated

## Configuration

The addon can be configured through the Home Assistant UI. Available configuration options:

### Required Configuration

- **Google Generative AI API Key**: API key for Google's Gemini AI models - **REQUIRED** for the addon to start ([Get your key](https://ai.google.dev/))

### Optional API Keys and Service Configuration

Configure the following additional options in the addon configuration page:

- **OpenWeatherMap API Key**: API key for weather forecasts and conditions ([Get your key](https://openweathermap.org/api))
- **Valdemarsro API Key**: API key for Danish recipe search
- **Bilka Email**: Email for Bilka shopping integration
- **Bilka Password**: Password for Bilka shopping integration
- **Bilka API Key**: API key for Bilka services
- **Bilka User Token**: User token for Bilka authentication
- **Algolia API Key**: API key for Algolia search (used by Bilka)
- **Algolia Application ID**: Application ID for Algolia search

### General Settings

- **Log Level**: Adjust logging verbosity (trace, debug, info, notice, warning, error, fatal)
- **Port**: Server runs on port 4111 by default (inherited from base image)

**Note**: While most API keys are optional, the **Google Generative AI API key is required** for the addon to start. Optional API keys enable specific features - for example, weather features require the OpenWeatherMap API key, and shopping features require Bilka credentials.

For advanced configuration and development details, see [AGENTS.md](./AGENTS.md).

## Architecture

```
Voice Input → Home Assistant → Jarvis Addon → AI Agents → Smart Devices
                                    ↓
                            Mastra MCP Server
                                    ↓
                    Weather • Shopping • Recipes • More
```

The addon wraps the `jarvis-mcp` Docker image and exposes it as a native Home Assistant addon with full API access.

## Troubleshooting

**Addon won't start?**
- Check logs in Home Assistant addon configuration
- Verify Docker image is available
- Ensure adequate system resources

**Can't access web UI?**
- Verify addon is running
- Try direct access: `http://[host]:4111/agents`
- Check Home Assistant ingress settings

**Voice integration not working?**
- Ensure Home Assistant API access is enabled
- Verify MCP server connectivity
- Check agent configurations in web UI

For detailed troubleshooting and development guidelines, see [AGENTS.md](./AGENTS.md).

## Links

- [Home Assistant Add-on Development](https://developers.home-assistant.io/docs/add-ons/)
- [Mastra Documentation](https://mastra.ai/docs)
- [Hey Jarvis GitHub Repository](https://github.com/ffMathy/hey-jarvis)
- [Development Guidelines](./AGENTS.md)

## License

Part of the Hey Jarvis ecosystem - see repository LICENSE for details.

## Configuration

The addon configuration is managed through the Home Assistant UI. See the configuration section above for details on available options including API keys and service credentials.

## Usage

1. **Start the Addon**: Click **Start** in the addon configuration
2. **Access Web UI**: Click **Open Web UI** or navigate to `http://[host]:4111/agents`
3. **Integrate with Home Assistant**: Use the MCP server for voice commands and automations

## Architecture

This addon is a thin wrapper around the `jarvis-mcp` Docker image:

- **Base Image**: `ghcr.io/ffmathy/jarvis-mcp:latest`
- **Port**: Exposes port 4111 for the Mastra server
- **Integration**: Uses Home Assistant ingress for secure web access
- **Permissions**: Configured with appropriate Home Assistant API access

## Development

### Building the Addon

```bash
# Build the addon Docker image
npx nx docker:build home-assistant-addon

# Test locally
npx nx serve home-assistant-addon
```

### Dependencies

This addon depends on the `jarvis-mcp` project. Ensure the base image is built first:

```bash
# Build the base jarvis-mcp image
npx nx docker:build jarvis-mcp

# Then build the addon
npx nx docker:build home-assistant-addon
```

## Troubleshooting

### Addon Won't Start

1. Check the addon logs in Home Assistant
2. Verify the base `jarvis-mcp` image is available
3. Ensure environment variables are properly configured

### Web UI Not Accessible

1. Verify the addon is running
2. Check if port 4111 is accessible
3. Try accessing directly: `http://[host]:4111/agents`

### Voice Integration Issues

1. Ensure Home Assistant API access is enabled
2. Check MCP server connectivity
3. Verify agent configurations in the web UI

## Links

- [Home Assistant Add-on Development](https://developers.home-assistant.io/docs/add-ons/)
- [Mastra Documentation](https://mastra.ai/docs)
- [Hey Jarvis GitHub Repository](https://github.com/ffMathy/hey-jarvis)
```

## Configuration

Configure the addon through the Home Assistant UI with your API keys and service credentials. See the configuration section above for all available options.

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