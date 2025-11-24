# Hey Jarvis - Digital Assistant Monorepo

An NX monorepo containing intelligent voice assistant components for comprehensive home automation.

<img width="1536" height="1024" alt="image" src="https://github.com/user-attachments/assets/f565c210-42df-4600-a1ab-5abb437bfcc9" />

## Projects

| Project | Description |
|---------|-------------|
| **elevenlabs** | End-to-end testing suite and conversational agent configuration for ElevenLabs voice interface |
| **mcp** | Mastra AI-powered Model Context Protocol server providing intelligent tools and agents |
| **home-assistant-addon** | Home Assistant addon for seamlessly hosting the Jarvis MCP server within your Home Assistant instance |
| **home-assistant-voice-firmware** | ESPHome firmware for dedicated voice hardware devices with local processing capabilities |

## Quick Start
Start the project in its DevContainer. Then use one of the below NX targets to try things out.

```bash
# Start the MCP server
nx serve mcp

# Build voice firmware
nx serve home-assistant-voice-firmware

# Start Home Assistant addon
nx serve home-assistant-addon
```

## Development

This monorepo uses NX for build orchestration and dependency management. Each project includes detailed documentation in its respective directory.
