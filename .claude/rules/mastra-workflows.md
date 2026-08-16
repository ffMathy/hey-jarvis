---
paths:
  - "mcp/mastra/verticals/**/workflows.ts"
  - "mcp/mastra/utils/workflows/**/*.ts"
---

# Mastra Workflows

**CRITICAL: ALWAYS use the factories from `../../utils/workflow-factory`:**

- `createWorkflow()` — create workflows
- `createStep()` — create custom steps
- `createAgentStep()` — use an agent as a step
- `createToolStep()` — use a tool as a step

## Basic Pattern

```typescript
import { createWorkflow, createStep } from '../../utils/workflow-factory';
import { z } from 'zod';

const myStep = createStep({
  id: 'my-step',
  description: 'What this step does',
  inputSchema: z.object({ input: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  execute: async ({ context }) => {
    return { result: context.input };
  },
});

export const myWorkflow = createWorkflow({
  id: 'myWorkflow',
  inputSchema: z.object({ input: z.string() }),
  outputSchema: z.object({ result: z.string() }),
}).then(myStep);
```

## Agent-as-Step

```typescript
const weatherStep = createAgentStep({
  id: 'weather-check',
  description: 'Get weather using weather agent',
  agentName: 'weather',
  inputSchema: z.object({ location: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  prompt: ({ context }) => `Get weather for ${context.location}`,
});
```

## Tool-as-Step

```typescript
const getCurrentWeatherStep = createToolStep({
  id: 'get-current-weather',
  description: 'Get current weather for a city',
  tool: getCurrentWeatherByCity,
  inputSchema: z.object({ location: z.string() }),
  inputTransform: ({ location }) => ({ cityName: location }),
});
```

## Which Pattern to Use

**Agent-as-step** when you need natural language processing, tool calling, conversation context, or flexible intelligent responses.

**Tool-as-step** when the operation is deterministic, is a direct API call, needs precise input/output control, or should be fast.

**Custom step** when you need complex data transformation, workflow-specific logic, several combined operations, or conditional branching.

## State Management — The One-Step Rule

**Only use state for values that must travel across more than one step.**

✅ **Use context** for immediate data flow between adjacent steps
✅ **Use state** only for long-distance sharing (2+ steps away)

```typescript
// NO state needed — values flow through context
const step1 = createAgentStep()({
  outputSchema: z.object({ result: z.string() }),
});

const step2 = createStep()({
  inputSchema: z.object({ result: z.string() }),  // from step1's context
  execute: async ({ context }) => ({ data: context.result }),
});

export const workflow = createWorkflow({
  // No stateSchema needed
}).then(step1).then(step2);
```

```typescript
// State needed — the value is consumed several steps later
const stateSchema = z.object({ persistedValue: z.string() });

const storeStep = createStep<typeof stateSchema>()({
  execute: async ({ context, workflow }) => {
    workflow.setState({ persistedValue: context.data });
    return {};
  },
});

const useStep = createStep<typeof stateSchema>()({
  execute: async ({ workflow }) => ({ data: workflow.state.persistedValue }),
});
```

## Chaining and Branching

```typescript
export const myWorkflow = createWorkflow({
  id: 'myWorkflow',
  inputSchema: z.object({}),
  outputSchema: z.object({}),
})
  .then(step1)
  .then(step2)
  .branch({
    when: ({ context }) => context.shouldBranch,
    thenWorkflow: branchWorkflow,
    elseWorkflow: defaultWorkflow,
  });
```

## What NOT to Do

❌ Never import from `@mastra/core/workflows` directly
❌ Never store in state what can flow through context
❌ Never write a custom step when agent-as-step or tool-as-step would do
❌ Never skip input/output schemas
❌ Never annotate step input/output types — they're inferred from schemas and prior steps
