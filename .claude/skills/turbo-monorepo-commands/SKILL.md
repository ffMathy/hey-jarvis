---
name: turbo-monorepo-commands
description: Always use Turborepo commands for building, testing, and serving projects in this monorepo
---

# TURBO Monorepo Commands

**CRITICAL: ALWAYS use Turborepo commands** for this monorepo. Never run commands directly or use npm.

## Required Command Pattern

For any project operation, use the TURBO command format:

```bash
bunx turbo <target> --filter=<project>
```

## Common Commands

**Development:**
```bash
bunx turbo serve --filter=<project>    # Start development server
```

**Build:**
```bash
bunx turbo build --filter=<project>    # Build for production
```

**Testing:**
```bash
bunx turbo test --filter=<project>                      # Run all tests
bunx turbo test --filter=<project> -- -- path/to/file.spec.ts  # Run specific file
```

**Linting:**
```bash
bunx turbo lint --filter=<project>     # Run linter
```

**Workspace Commands:**
```bash
bunx turbo lint
bunx turbo test
bunx turbo build
```

## Projects in Monorepo

- `mcp` - Mastra AI-powered Model Context Protocol server
- `elevenlabs` - ElevenLabs voice interface integration
- `home-assistant-voice-firmware` - ESPHome firmware

## What NOT to Do

❌ **NEVER** use these patterns:
- `npm run <script>` - Wrong package manager
- Running commands directly without TURBO
- Using `node` or other direct execution

## Timeouts

Always use appropriate timeouts for commands:
- Quick operations (linting): 30-60 seconds
- Builds and tests: 120-300 seconds
- Docker builds: 600-900 seconds

```bash
timeout 30 bunx turbo lint --filter=mcp
timeout 180 bunx turbo build --filter=mcp
timeout 180 bunx turbo test --filter=mcp
```
