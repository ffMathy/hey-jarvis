---
paths:
  - "mcp/**"
---

# Testing Requirements

> Part of [Jarvis Mastra AI Agents → Development](mcp-development.md). Paths in it are relative to `mcp/` unless they say otherwise.

**Where a test belongs**

A spec that needs a credential, reaches the network, or starts the MCP server is
named `*.integration.spec.ts` and runs under `turbo test:integration`, which is
the only target that resolves secrets from 1Password. Everything else keeps the
plain `*.spec.ts` suffix and runs under `turbo test`, which carries no secrets at
all — so a test that quietly starts reaching for one fails there rather than
passing on someone's personal account.

CI runs `turbo test` on every push. `turbo test:integration` never runs on
GitHub Actions — only when someone runs the target by hand.

**CRITICAL: Test Server Startup Must Use run-with-env.sh**

When starting the MCP server for testing purposes, **ALWAYS use `run-with-env.sh` directly with tsx** to ensure proper environment variable loading from 1Password without nested TURBO process issues:

✅ **CORRECT:**
```bash
# Tests should start the server using run-with-env.sh + tsx directly
./.scripts/run-with-env.sh mcp/op.env bunx tsx mcp/mastra/mcp-server.ts
```

❌ **INCORRECT:**
```bash
# Don't use Turborepo tasks - they cause nested TURBO processes in test environment
bun run --cwd mcp serve:mcp
bun run --cwd mcp serve:mcp

# Don't bypass run-with-env.sh - environment variables won't load
bunx tsx mcp/mastra/mcp-server.ts
```

**Why This Matters:**
- The `run-with-env.sh` script ensures 1Password CLI authentication and environment variable injection
- Direct tsx execution avoids nested TURBO process issues that cause premature exit
- Tests run in the same environment as development and need access to secrets
- Without run-with-env.sh, required environment variables won't be available
- This approach provides the simplest, most direct path to a running server

**Test Implementation Pattern:**
```typescript
// In test setup files (e.g., mcp-server-manager.ts)
mcpServerProcess = spawn('./.scripts/run-with-env.sh', [
    'mcp/op.env',
    'bunx',
    'tsx',
    'mcp/mastra/mcp-server.ts'
], {
    detached: true,
    stdio: ['ignore', 'inherit', 'inherit'],
    cwd: '/workspaces/hey-jarvis',
});
```
