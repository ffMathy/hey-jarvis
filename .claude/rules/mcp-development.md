---
paths:
  - "mcp/**"
---

# Development

> Part of [Jarvis Mastra AI Agents](mcp.md). Paths in it are relative to `mcp/` unless they say otherwise.

## Prerequisites
```bash
# Install Mastra globally
bun install mastra --global
```

## Running the Project
```bash
# Start development server with playground
bunx turbo serve --filter=mcp

# Build for production
bunx turbo build --filter=mcp
```

## Development Playground
Access the Mastra development playground at `http://localhost:4111/agents` to:
- Test agents interactively
- Monitor agent memory and state
- Debug tool calls and workflows
- View execution traces and performance metrics

## Split into its own rules

- [Testing Requirements](mcp-testing-requirements.md)
- [Environment Setup](mcp-environment-setup.md)
- [Google OAuth2 Setup](mcp-google-oauth2-setup.md)
- [Microsoft OAuth2 Setup](mcp-microsoft-oauth2-setup.md)
- [Adding New OAuth Providers](mcp-adding-new-oauth-providers.md)
