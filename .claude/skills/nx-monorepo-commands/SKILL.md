---
name: nx-monorepo-commands
description: Guide for using NX commands in the Hey Jarvis monorepo. Use this when working with any project in the repository that requires building, testing, linting, or serving.
---

# NX Monorepo Commands

**CRITICAL: ALWAYS use NX commands** for this monorepo. Never run commands directly or use npm.

## Required Command Pattern

For any project operation, use the NX command format:

```bash
bunx nx <target> <project>
```

## Common Commands

**Development:**
```bash
bunx nx serve <project>    # Start development server
```

**Build:**
```bash
bunx nx build <project>    # Build for production
```

**Testing:**
```bash
bunx nx test <project>     # Run tests
```

**Linting:**
```bash
bunx nx lint <project>     # Run linter
```

**Affected Commands:**
```bash
bunx nx affected --target=lint
bunx nx affected --target=test
bunx nx affected --target=build
```

## Projects in Monorepo

- `mcp` - Mastra AI-powered Model Context Protocol server
- `elevenlabs` - ElevenLabs voice interface integration
- `home-assistant-addon` - Home Assistant addon
- `home-assistant-voice-firmware` - ESPHome firmware

## What NOT to Do

❌ **NEVER** use these patterns:
- `npm run <script>` - Wrong package manager
- Running commands directly without NX
- Using `node` or other direct execution

## Timeouts

Always use appropriate timeouts for commands:
- Quick operations (linting): 30-60 seconds
- Builds and tests: 120-300 seconds
- Docker builds: 600-900 seconds

```bash
timeout 30 bunx nx lint mcp
timeout 180 bunx nx build mcp
timeout 180 bunx nx test mcp
```
