# Hey Jarvis - Digital Assistant Monorepo

An NX monorepo containing intelligent voice assistant components for comprehensive home automation.

## Projects

| Project | Description | Serve Command |
|---------|-------------|--------------|
| **elevenlabs** | End-to-end testing suite and conversational agent configuration for ElevenLabs voice interface | - |
| **jarvis-mcp** | Mastra AI-powered Model Context Protocol server providing intelligent tools and agents | `nx serve jarvis-mcp` |
| **home-assistant-addon** | Home Assistant addon for seamlessly hosting the Jarvis MCP server within your Home Assistant instance | `nx serve home-assistant-addon` |
| **home-assistant-voice-firmware** | ESPHome firmware for dedicated voice hardware devices with local processing capabilities | `nx build home-assistant-voice-firmware` |

## Quick Start

```bash
# Install dependencies
npm install

# Start the MCP server
nx serve jarvis-mcp

# Build voice firmware
nx build home-assistant-voice-firmware

# Start Home Assistant addon
nx serve home-assistant-addon
```

## Development

This monorepo uses NX for build orchestration and dependency management. Each project includes detailed documentation in its respective directory.
