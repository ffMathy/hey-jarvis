# DevContainer Configuration

This DevContainer is configured to provide a complete development environment for Hey Jarvis.

## Post-Creation Setup

After the DevContainer is created, dependencies are automatically installed via `npm install`.

## Manual Initialization

Some projects require additional initialization steps that are **not** run automatically during DevContainer creation. To initialize specific projects:

```bash
# Initialize a specific project (e.g., home-assistant-voice-firmware)
npx nx run home-assistant-voice-firmware:init

# Initialize all projects (may take several minutes)
npx nx run-many --target=init --all --parallel=1
```

### Project-Specific Initialization

- **home-assistant-voice-firmware**: Installs ESPHome for ESP32 firmware development
- **jarvis-mcp**: No initialization required
- **elevenlabs**: No initialization required
- **home-assistant-addon**: No initialization required

## Why Manual Initialization?

The automatic initialization was removed from the `postCreateCommand` because:

1. **Performance**: ESP-IDF toolchain installation is heavy and can timeout in CI environments
2. **Flexibility**: Developers can choose which projects to initialize based on their needs
3. **Reliability**: Prevents CI build failures due to optional toolchain installations

## Development Workflow

1. DevContainer starts and runs `npm install`
2. Run manual init for projects you need: `npx nx run PROJECT:init`
3. Build your changes: `npm run build`
4. Test your changes: `npm run test`
