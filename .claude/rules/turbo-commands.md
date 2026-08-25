# Turborepo Commands

**CRITICAL: ALWAYS use Turborepo commands** for this monorepo. Never run package scripts directly, and never use npm.

## Required Command Pattern

```bash
bunx turbo <target> --filter=<project>
```

## Common Commands

```bash
bunx turbo serve --filter=<project>    # Start development server
bunx turbo build --filter=<project>    # Build for production
bunx turbo test  --filter=<project>    # Run the mocked tests (no secrets needed)
bunx turbo lint  --filter=<project>    # Run linter

bunx turbo test:integration --filter=<project>   # Tests that use real credentials

bunx turbo test --filter=<project> -- -- path/to/file.spec.ts   # Single test file
```

`test` and `test:integration` split the suite by file name: `*.integration.spec.ts`
belongs to the latter, everything else to the former. Only `test:integration`
resolves secrets from 1Password.

Omit `--filter` to run a target across the whole workspace:

```bash
bunx turbo lint
bunx turbo test
bunx turbo build
```

## Projects in the Monorepo

- `mcp` — Mastra AI-powered Model Context Protocol server
- `elevenlabs` — ElevenLabs voice interface integration
- `home-assistant-voice-firmware` — ESPHome firmware

## Timeouts

Every shell command must run under GNU `timeout` (enforced by the `require-timeout` hook). Pick a duration that fits the work:

- Quick operations (linting): 30–60 seconds
- Builds and tests: 120–300 seconds
- Docker builds: 600–900 seconds

```bash
timeout 30 bunx turbo lint --filter=mcp
timeout 180 bunx turbo build --filter=mcp
timeout 180 bunx turbo test --filter=mcp
```

## What NOT to Do

❌ **NEVER** use `npm run <script>` — wrong package manager
❌ **NEVER** invoke the underlying tool directly when a Turbo target exists
❌ **NEVER** guess CLI flags — check `turbo --help` first
