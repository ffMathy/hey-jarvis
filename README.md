# Hey Jarvis

An intelligent voice assistant for home automation, powered by AI agents and custom voice hardware.

<img width="1536" height="1024" alt="Hey Jarvis" src="https://github.com/user-attachments/assets/f565c210-42df-4600-a1ab-5abb437bfcc9" />

## Architecture

```
ESP32 Voice Hardware  ←→  Home Assistant  ←→  MCP Server (Mastra AI)  ←→  ElevenLabs Voice
```

## Projects

| Project | Description |
|---------|-------------|
| [**mcp**](./mcp) | Mastra AI-powered MCP server with 15+ agents across 16 domains (weather, shopping, IoT, calendar, etc.) |
| [**elevenlabs**](./elevenlabs) | CLI for deploying and testing the ElevenLabs voice agent |
| [**home-assistant-voice-firmware**](./home-assistant-voice-firmware) | ESPHome firmware for ESP32 voice devices with ElevenLabs streaming |

## Quick Start

Open in a DevContainer — all dependencies are pre-installed.

```bash
bunx nx serve mcp                              # Start MCP server + playground
bunx nx deploy elevenlabs                       # Deploy voice agent
bunx nx serve home-assistant-voice-firmware     # Flash firmware over WiFi
```

## Development

- **Build system**: NX monorepo
- **Package manager**: Bun
- **Code quality**: Biome (formatting + linting), TypeScript strict mode
- **Commits**: Conventional Commits enforced via commitlint + husky
- **Secrets**: 1Password CLI — NX targets inject credentials via `op run`
- **CI/CD**: GitHub Actions with DevContainer, Release Please for versioning

```bash
bunx nx affected --target=test      # Test affected projects
bunx nx run-many --target=lint      # Lint everything
bunx biome check --write .          # Format + lint
```

Each project has an `AGENTS.md` with detailed development guidelines.
