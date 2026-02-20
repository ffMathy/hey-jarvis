# Creating Mastra Workflows

Use the Hey Jarvis factory pattern for creating workflows and leverage modern patterns.

## Factory Functions

**CRITICAL: ALWAYS use these factories:**
- `createWorkflow()` - Create workflows
- `createStep()` - Create custom steps
- `createAgentStep()` - Use agent as step
- `createToolStep()` - Use tool as step

All from `../../utils/workflow-factory`

## Basic Workflow Pattern

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

## Agent-as-Step Pattern

Use existing agents directly as workflow steps:

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

**Benefits:**
- Leverages existing agent intelligence
- Consistent with standalone agent behavior
- Automatic tool access
- Memory integration

## Tool-as-Step Pattern

Use existing tools directly as workflow steps:

```typescript
const getCurrentWeatherStep = createToolStep({
  id: 'get-current-weather',
  description: 'Get current weather for a city',
  tool: getCurrentWeatherByCity,
  inputSchema: z.object({ location: z.string() }),
  inputTransform: ({ location }) => ({ cityName: location }),
});
```

**Benefits:**
- Direct tool execution (faster)
- Precise input/output transformation
- Better for deterministic operations

## When to Use Each Pattern

**Use Agent-as-Step when:**
- Need natural language processing
- Require tool calling capabilities
- Want conversation context
- Need flexible, intelligent responses

**Use Tool-as-Step when:**
- Have deterministic operations
- Need direct API calls
- Want precise input/output control
- Prefer faster execution

**Use Custom Steps when:**
- Need complex data transformation
- Require workflow-specific logic
- Must combine multiple operations
- Need conditional branching

## Workflow State Management

**The One-Step Rule**: Only use state for values that need to travel across **more than one step**.

✅ **Use context** for immediate data flow (adjacent steps)
✅ **Use state** for long-distance data sharing (2+ steps away)

```typescript
// NO state needed - values flow through context
const step1 = createAgentStep()({
  outputSchema: z.object({ result: z.string() }),
});

const step2 = createStep()({
  inputSchema: z.object({ result: z.string() }),  // From step1 context
  execute: async ({ context }) => ({ data: context.result }),
});

export const workflow = createWorkflow({
  // No stateSchema needed
}).then(step1).then(step2);
```

```typescript
// State needed - value used multiple steps later
const stateSchema = z.object({
  persistedValue: z.string(),
});

const storeStep = createStep<typeof stateSchema>()({
  execute: async ({ context, workflow }) => {
    workflow.setState({ persistedValue: context.data });
    return {};
  },
});

const useStep = createStep<typeof stateSchema>()({
  execute: async ({ workflow }) => {
    return { data: workflow.state.persistedValue };
  },
});
```

## Workflow Chaining

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
❌ Never create custom steps when agent/tool-as-step works
❌ Never skip input/output schemas
