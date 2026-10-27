# Hey Jarvis

An intelligent voice assistant for home automation, powered by AI agents and custom voice hardware.

<img width="1280" height="640" alt="Jarvis" src="./docs/jarvis.png" />

## On your phone and watch

Hold the power button and he comes up over whatever you were doing. On the watch he is the whole screen.

<p align="center">
  <picture>
    <source srcset="./docs/jarvis-on-a-phone.webp" type="image/webp" />
    <img width="240" alt="Jarvis summoned on a phone" src="./docs/jarvis-on-a-phone.gif" />
  </picture>
  &nbsp;&nbsp;
  <picture>
    <source srcset="./docs/jarvis-on-a-watch.webp" type="image/webp" />
    <img width="260" alt="Jarvis summoned on a watch" src="./docs/jarvis-on-a-watch.gif" />
  </picture>
</p>

<sub>Watch clips are CC BY-SA 4.0 because of the device frame. See [NOTICE](./hologram/.scripts/device-art/NOTICE.md).</sub>

## In your room

Say "Hey Jarvis" on a Meta Quest and he appears where there is space for him. [Open it on the headset](https://ffmathy.github.io/hey-jarvis/vr/).

<p align="center">
  <picture>
    <source srcset="./docs/jarvis-in-a-room.webp" type="image/webp" />
    <img width="640" alt="Jarvis standing in a living room, seen through a Meta Quest while walking up to him and round him" src="./docs/jarvis-in-a-room.gif" />
  </picture>
</p>

🔊 [Watch it with sound](./docs/jarvis-in-a-room.webm)

## Architecture

```
ESP32 Voice Hardware  ←→  Home Assistant  ←→  MCP Server (Mastra AI)  ←→  ElevenLabs Voice
```

| Project | What it is |
|---------|------------|
| [**mcp**](./mcp) | Mastra MCP server with 15+ agents (weather, shopping, IoT, calendar, …) |
| [**elevenlabs**](./elevenlabs) | Deploys and tests the ElevenLabs voice agent |
| [**home-assistant-voice-firmware**](./home-assistant-voice-firmware) | ESPHome firmware for ESP32 voice devices |
| [**hologram**](./hologram) | The sphere and its voice tracking, shared by every app |
| [**mobile**](./mobile) | Phone app: the power button summons Jarvis |
| [**watch**](./watch) | The same on Wear OS |
| [**vr**](./vr) | WebXR app for Meta Quest |

## Quick Start

Open in the DevContainer, then:

```bash
bunx turbo serve --filter=mcp                              # MCP server + playground
bunx turbo deploy --filter=elevenlabs                      # Deploy the voice agent
bunx turbo serve --filter=home-assistant-voice-firmware    # Flash firmware over WiFi

bunx turbo test              # Mocked tests, no credentials
bunx turbo test:integration  # Tests against real services
bunx turbo lint
```

Publishing to Google Play: [docs/play-store.md](./docs/play-store.md). Development conventions: [`.claude/rules/`](./.claude/rules/).
