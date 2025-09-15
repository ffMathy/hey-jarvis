# Hey Jarvis - Digital Assistant Monorepo

A collection of simple "Hello World" applications demonstrating the foundation for a digital assistant system that can run your house.

## Monorepo Structure

This is an NX monorepo containing three main projects, each implementing simple "Hello World" applications as foundations for future development:

### Projects

- **jarvis-mcp** - TypeScript "Hello World" application serving as foundation for Model Context Protocol server
- **home-assistant-voice-firmware** - C++ "Hello World" application for future Home Assistant voice processing
- **e2e** - TypeScript "Hello World" application for future end-to-end testing capabilities

## Development Environment

### DevContainer Support
This repository includes a DevContainer configuration for consistent development environments:
- TypeScript/Node.js support
- C++ development tools
- NX workspace tools
- VS Code extensions pre-configured

Open in VS Code and select "Reopen in Container" to use the DevContainer.

### Prerequisites

- Node.js (v20+)
- npm
- g++ compiler (for C++ project)
- Docker (for DevContainer support)

## Getting Started

### Installation

```bash
npm install
```

### Building All Projects

```bash
npm run build
```

### Running Individual Projects

#### Jarvis MCP Application
```bash
npm run serve:jarvis-mcp
# Or: npx nx serve jarvis-mcp
```

#### Home Assistant Voice Firmware
```bash
npm run serve:home-assistant-voice-firmware
# Or: npx nx serve home-assistant-voice-firmware
```

#### E2E Application
```bash
npm run serve:e2e
# Or: npx nx serve e2e
```

### Building Individual Projects

```bash
# Build jarvis-mcp
npm run build:jarvis-mcp
# Or: npx nx build jarvis-mcp

# Build home-assistant-voice-firmware
npm run build:home-assistant-voice-firmware
# Or: npx nx build home-assistant-voice-firmware

# Build e2e
npm run build:e2e
# Or: npx nx build e2e
```

## Agent Documentation

Each project includes detailed agent documentation:
- [E2E Agents](./e2e/AGENTS.md)
- [Home Assistant Voice Firmware Agents](./home-assistant-voice-firmware/AGENTS.md)
- [Jarvis MCP Agents](./jarvis-mcp/AGENTS.md)

## Development

This project uses NX for monorepo management. You can use NX commands directly:

```bash
# Show project graph
npx nx graph

# Run specific target for a project
npx nx build jarvis-mcp
npx nx serve home-assistant-voice-firmware

# Run target for all projects
npx nx run-many --target=build --all
```

## Future Development

These "Hello World" applications serve as foundations for:
- Model Context Protocol integration
- Voice processing and recognition
- Home automation control
- Cross-project communication
- AI agent coordination
