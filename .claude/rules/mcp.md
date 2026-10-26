---
paths:
  - "mcp/**"
---

# Jarvis Mastra AI Agents

> Paths in this rule are relative to `mcp/` unless they say otherwise.

## Its rules

Each topic is a rule of its own, under the same paths:

- [Project Structure](mcp-project-structure.md)
- [Key Features](mcp-key-features.md)
- [Current Agents](mcp-current-agents.md)
- [Available Workflows](mcp-available-workflows.md)
- [Jev Classifiers](mcp-jev-classifiers.md)
- [Processors](mcp-processors.md)
- [Agent-as-Step and Tool-as-Step Patterns](mcp-agent-as-step-and-tool-as-step-patterns.md)
- [Development](mcp-development.md)
- [MCP Server Access](mcp-mcp-server-access.md)
- [Integration Capabilities](mcp-integration-capabilities.md)
- [Architecture Benefits](mcp-architecture-benefits.md)
- [Vertical Organization Conventions](mcp-vertical-organization-conventions.md)
- [Future Roadmap](mcp-future-roadmap.md)
- [Development Guidelines](mcp-development-guidelines.md)

## Overview
Mastra-powered AI agent framework for intelligent home automation, voice interactions, and Model Context Protocol (MCP) integrations.

## About Mastra
[Mastra](https://mastra.ai) is a TypeScript agent framework for production-ready AI applications with unified LLM interfaces, persistent memory, tool calling, and graph-based workflows.

**This project uses Mastra V1 beta** (v1.0.0-beta.2).

### Key API Changes from V0
- `streamVNext()` → `stream()` - Standard streaming API
- `generateVNext()` → `generate()` - Standard generation API
- Full AI SDK v5 compatibility

## Contributing
- Follow TypeScript best practices
- Include proper agent memory management
- Implement comprehensive tool validation
- Add appropriate workflow testing
- Apply YAGNI principle

### Scope Guidelines for Commits
Use MCP-specific scopes:
- `mcp`, `agents`, `workflows`, `tools`
- `weather`, `shopping`, `cooking`

For more information about Mastra development, visit the [official documentation](https://mastra.ai/docs).
