---
paths:
  - "mcp/**"
---

# Development Guidelines

> Part of [Jarvis Mastra AI Agents](mcp.md). Paths in it are relative to `mcp/` unless they say otherwise.

## Agent Architecture Guidelines
When refactoring or creating agents:
- **Prefer specialized agents** over single multi-purpose agents for complex workflows
- **Keep agent prompts focused** on specific cognitive tasks
- **Use clear separation of concerns** between search, selection, generation, and formatting
- **Maintain backward compatibility** by keeping original agent names as aliases
- **Update the main Mastra index** to register all new specialized agents
- **Test agent interactions** using the Mastra playground at `http://localhost:4111/agents`

## Split into its own rules

- [Core Development Principles](mcp-core-development-principles.md)
- [File Creation Policy](mcp-file-creation-policy.md)
- [Tool ID Naming Conventions](mcp-tool-id-naming-conventions.md)
- [Factory Pattern Usage](mcp-factory-pattern-usage.md)
- [Workflow State Management Guidelines](mcp-workflow-state-management-guidelines.md)
- [Scorers and Evaluation](mcp-scorers-and-evaluation.md)
