---
name: mastra-development
description: Complete guide for Mastra development — agents, tools, workflows, vertical organization, and type safety
---

# Mastra Development

This skill covers all conventions for building with Mastra in the Hey Jarvis project. Always use the factory patterns — never import from Mastra's core packages directly.

## Topics

- **[Agent Creation](agent-creation.md)** — `createAgent()` factory, file structure, naming conventions, registration steps
- **[Tool Creation](tool-creation.md)** — `createTool()` factory, critical naming rules, export pattern, input/output schemas
- **[Workflow Creation](workflow-creation.md)** — `createWorkflow()`, agent-as-step, tool-as-step, state management
- **[Vertical Organization](vertical-organization.md)** — Domain-based folder structure, naming conventions, export patterns
- **[Type Safety](type-safety.md)** — Never cast to fix version bumps, let SDK types flow, use `satisfies`

## Quick Reference

### Factories (always use these)

| What | Factory | Import from |
|------|---------|-------------|
| Agent | `createAgent()` | `../../utils/agent-factory` |
| Tool | `createTool()` | `../../utils/tool-factory` |
| Workflow | `createWorkflow()` | `../../utils/workflow-factory` |
| Step | `createStep()` | `../../utils/workflow-factory` |
| Agent step | `createAgentStep()` | `../../utils/workflow-factory` |
| Tool step | `createToolStep()` | `../../utils/workflow-factory` |

### Vertical Structure

```
mastra/verticals/[vertical-name]/
├── agent.ts      # or agents.ts for multiple
├── tools.ts
├── workflows.ts
└── index.ts
```

### Critical Rules

- Tool ID, variable name, and export key **must all match** (camelCase)
- **Never cast** (`as`) to fix type errors after version bumps
- **Never import** from `@mastra/core/*` directly — always use factories
- Tools belong to **exactly one vertical**
