# hey-jarvis

My digital assistant that runs the house.

## Monorepo Structure

This is an NX monorepo containing three main projects:

### Projects

- **jarvis-mcp** - Node.js application implementing Model Context Protocol server for Jarvis
- **home-assistant-voice-firmware** - C++ application for Home Assistant voice processing
- **e2e** - Node.js end-to-end testing suite

## Getting Started

### Prerequisites

- Node.js (v20+)
- npm
- g++ compiler (for C++ project)

### Installation

```bash
npm install
```

### Building All Projects

```bash
npm run build
```

### Running Individual Projects

#### Jarvis MCP Server
```bash
npm run serve:jarvis-mcp
```

#### Home Assistant Voice Firmware
```bash
npm run serve:home-assistant-voice-firmware
```

#### E2E Tests
```bash
npm run serve:e2e
```

### Building Individual Projects

```bash
# Build jarvis-mcp
npm run build:jarvis-mcp

# Build home-assistant-voice-firmware
npm run build:home-assistant-voice-firmware

# Build e2e
npm run build:e2e
```

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
