# Hey Jarvis

An intelligent voice assistant for home automation, powered by AI agents and custom voice hardware.

<img width="1536" height="1024" alt="Hey Jarvis" src="https://github.com/user-attachments/assets/f565c210-42df-4600-a1ab-5abb437bfcc9" />

## Jarvis, summoned

Hold the power button on the phone and Jarvis comes up over whatever you were doing; on the watch he is the whole screen. Here he is at rest, then speaking, then working through something, and then gone.

<p align="center">
  <img width="260" alt="Jarvis summoned on a phone" src="./docs/jarvis-on-a-phone.gif" />
  &nbsp;&nbsp;
  <img width="240" alt="Jarvis summoned on a watch" src="./docs/jarvis-on-a-watch.gif" />
</p>

One sphere, drawn once. Both devices bundle the same [`hologram`](./hologram) package, which is why there is no version of him that is only on the phone. These clips are that same drawing rendered frame by frame at 1300 particles — more than any phone is asked for, since nothing offline has to hold sixty frames a second — by [`hologram/.scripts/render-showcase.ts`](./hologram/.scripts/render-showcase.ts). The GIFs above are cut to 30 fps so a README does not weigh ten megabytes; the full 60 fps versions are here as WebM: [phone](./docs/jarvis-on-a-phone.webm), [watch](./docs/jarvis-on-a-watch.webm).

```bash
bun hologram/.scripts/render-showcase.ts
```

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
| [**mobile**](./mobile) | Expo app that registers as the phone's default assistant, so the power button summons Jarvis |
| [**wear**](./wear) | The same thing on a Wear OS watch |
| [**hologram**](./hologram) | The sphere itself, and the voice tracking behind it — platform-free, and bundled by both apps |

## Quick Start

Open in a DevContainer — all dependencies are pre-installed.

```bash
bunx turbo serve --filter=mcp                              # Start MCP server + playground
bunx turbo deploy --filter=elevenlabs                       # Deploy voice agent
bunx turbo serve --filter=home-assistant-voice-firmware     # Flash firmware over WiFi
```

## Development

- **Build system**: Turborepo monorepo
- **Package manager**: Bun
- **Code quality**: Biome (formatting + linting), TypeScript strict mode
- **Commits**: Conventional Commits enforced via commitlint in a git hook
- **Secrets**: 1Password CLI — Turborepo tasks inject credentials via `op run`
- **CI/CD**: GitHub Actions with DevContainer, Release Please for versioning
- **Supply chain**: Bun-only installs, exact version pins, a 7-day release cooldown, no dependency install scripts, SHA-pinned Actions — see [AGENTS.md](./AGENTS.md#supply-chain-security)

```bash
bunx turbo test              # Mocked tests — no credentials needed
bunx turbo test:integration  # The tests that call real services
bunx turbo lint              # Lint everything
bunx biome check --write .   # Format + lint
```

CI runs `turbo test` on every push. `turbo test:integration` waits until the
pull request is marked ready for review, and then runs on every push after that.

Each project has an `AGENTS.md` with detailed development guidelines.
