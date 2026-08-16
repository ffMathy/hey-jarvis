---
paths:
  - "mcp/mastra/**/*.ts"
---

# Mastra Development

Conventions for building with Mastra in the Hey Jarvis project. **Always use the project's factory patterns — never import from Mastra's core packages directly.**

## Factories (always use these)

| What | Factory | Import from |
| --- | --- | --- |
| Agent | `createAgent()` | `../../utils/agent-factory` |
| Tool | `createTool()` | `../../utils/tool-factory` |
| Workflow | `createWorkflow()` | `../../utils/workflow-factory` |
| Step | `createStep()` | `../../utils/workflow-factory` |
| Agent step | `createAgentStep()` | `../../utils/workflow-factory` |
| Tool step | `createToolStep()` | `../../utils/workflow-factory` |

❌ **Never import from `@mastra/core/*` directly.**

## Vertical Organization

Code is grouped by **business domain**, not by technical layer. Related agents, tools, and workflows live together (weather, shopping, cooking) rather than being split into an agents folder, a tools folder, and so on.

### Simple vertical (1–2 agents)

```
mastra/verticals/[vertical-name]/
├── agent.ts          # Single general-purpose agent
├── tools.ts          # All tools for this vertical
├── workflows.ts      # All workflows
└── index.ts          # Export everything
```

### Moderate vertical (2–3 specialized agents)

Same shape, but `agents.ts` (plural) instead of `agent.ts`.

### Complex vertical (4+ agents or multiple specialized flows)

```
mastra/verticals/[vertical-name]/
├── agent.ts                    # General vertical agent
├── tools.ts                    # Shared tools
├── [sub-vertical-name]/        # Specialized sub-vertical
│   ├── agents.ts
│   ├── workflows.ts
│   └── index.ts
└── index.ts
```

Example: `cooking/meal-planning/`.

**Create a sub-vertical when** there are more than 4 specialized agents, several distinct workflows share some tools, or there is a clear logical separation inside the vertical.

### File naming

- Single agent: `agent.ts` · Multiple agents: `agents.ts`
- Tools: always `tools.ts` · Workflows: always `workflows.ts` · Exports: always `index.ts`

### Export pattern

```typescript
// verticals/[vertical]/index.ts
export { myAgent } from './agent';
export { myTools } from './tools';
export { myWorkflow } from './workflows';

// verticals/index.ts
export * from './weather';
export * from './shopping';
```

### Tool ownership

1. Each tool belongs to **exactly one** vertical
2. Don't share tools across verticals
3. If a tool is genuinely shared, create a `shared/` vertical

## Type Safety

**CRITICAL: Never use type casts (`as`) to fix Mastra type errors** — especially after version bumps. A cast hides a real incompatibility and breaks silently at runtime.

When Mastra upgrades change types, **adapt your code to the new types** instead of casting old shapes into new ones. If a type changed, the API contract changed.

1. **Let types be inferred** from the SDK — don't annotate return types of `createTool()`, `createAgent()`, or workflow steps
2. **Never cast to fix a version bump** — read the changelog and fix the root cause
3. **Use `satisfies`** to check a config object without losing inference
4. **Trust the SDK's generics** — tools, agents, and workflows carry rich types; let them flow
5. **Use Zod schemas** for runtime validation at boundaries, not casts

❌ **BAD — casting to silence a version bump:**

```typescript
const result = step.output as unknown as LegacyStepResult;
```

✅ **GOOD — let types flow, and use `satisfies` for configs:**

```typescript
const agentConfig = {
  name: 'MyAgent',
  instructions: 'You are a helpful agent.',
  tools: myTools,
} satisfies Parameters<typeof createAgent>[0];

// WRONG
const response = await agent.generate(prompt) as { text: string };

// RIGHT
const response = await agent.generate(prompt);
const text = response.text;
```

Mastra is in active development, so its types change often. Casts turn each upgrade into invisible tech debt and bypass constraints (schema validation, step chaining) the type system is there to enforce.
