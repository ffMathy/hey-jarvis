---
name: port-configuration-management
description: Checklist for updating port configurations across all files. Use this when changing any service port numbers in the project.
---

# Port Configuration Management

**CRITICAL: When changing ports, ALWAYS update ALL of these files.**

## Complete Update Checklist

When changing a port, update these files in order:

### 1. Service Configuration
- [ ] `mcp/supervisord.conf` - Production service ports
- [ ] `home-assistant-addon/supervisord.conf` - Addon service ports
- [ ] `home-assistant-addon/tests/supervisord-test.conf` - Test service ports

### 2. Port Constants
- [ ] `mcp/lib/ports.sh` - Bash port constants (centralized)
- [ ] `home-assistant-addon/tests/e2e/helpers/ports.ts` - TypeScript port constants (centralized)

### 3. Proxy Configuration
- [ ] `home-assistant-addon/nginx.conf` - Production nginx proxy targets
- [ ] `home-assistant-addon/tests/nginx.tests.conf` - Test nginx proxy targets

### 4. Home Assistant Addon Metadata ⚠️
- [ ] `home-assistant-addon/config.json` - Port mappings and descriptions for Home Assistant UI

### 5. Documentation
- [ ] `mcp/AGENTS.md` - Update port references in documentation

## Verification Steps

After updating all files:

1. **Grep for old port**: `grep -r "OLD_PORT" .`
2. **Run tests**: `bunx nx test home-assistant-addon`
3. **Build addon**: `bunx nx build home-assistant-addon`
4. **Start locally**: `bunx nx serve mcp`

## Why All Files Matter

- **supervisord.conf**: Services must bind to correct ports
- **ports.sh/ports.ts**: Scripts reference centralized constants
- **nginx.conf**: Proxy must forward to correct backend ports
- **config.json**: Home Assistant displays correct port info to users
- **AGENTS.md**: Developers need accurate documentation

## Common Ports in Project

Current port allocation:
- `4111` - Mastra Dev UI (via ingress)
- `4112` - MCP Server (both internal and external)
- `8111` - Internal Mastra Dev (behind nginx auth)

## DRY Principle

Port constants are centralized:
- **Bash scripts**: Source `mcp/lib/ports.sh`
- **TypeScript**: Import from `tests/e2e/helpers/ports.ts`

Never hardcode port numbers outside these central locations.

## Example Port Change

To change Mastra Dev port from 8111 to 8222:

1. Update `ports.sh`: `MASTRA_DEV_INTERNAL_PORT=8222`
2. Update `ports.ts`: `export const MASTRA_DEV_INTERNAL_PORT = 8222;`
3. Update supervisord configs: Change all `[program:mastra-dev]` ports
4. Update nginx configs: Change all `proxy_pass` directives
5. Update `config.json`: Update port descriptions
6. Update `AGENTS.md`: Update port references
7. Verify: `grep -r "8111" . --exclude-dir=node_modules`
