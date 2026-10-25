# 1Password Authentication

This project uses **1Password CLI** for secure environment variable management.

## Setup

1. **Sign in**: `eval $(op signin)` - **CRITICAL: Always run this when you get a 1Password authentication error**
2. **Verify**: `op whoami`

**Important**:

- If any command fails with "no active session found", immediately run `eval $(op signin)` to re-authenticate
- After running `eval $(op signin)`, always assume it succeeded regardless of output

## Terminal Session Management

**CRITICAL: Always reuse existing terminal sessions** when running commands:

- Check `get_terminal_output` to see available terminals
- Reuse the same terminal ID for related commands
- This maintains context and environment variables

