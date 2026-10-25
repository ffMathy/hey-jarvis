---
paths:
  - "mcp/**"
---

# Factory Pattern Usage

> Part of [Jarvis Mastra AI Agents → Development Guidelines](mcp-development-guidelines.md). Paths in it are relative to `mcp/` unless they say otherwise.

**CRITICAL**: All agents, tools, and workflows must be created using the Hey Jarvis factory functions:

## 🏭 **Required Factory Functions**
- **Agents**: Use `createAgent()` from `../../utils/agent-factory`
- **Tools**: Use `createTool()` from `../../utils/tool-factory`  
- **Workflows**: Use `createWorkflow()` and `createStep()` from `../../utils/workflow-factory`
- **Agent-as-Step**: Use `createAgentStep()` from `../../utils/workflow-factory` to use agents directly as workflow steps
- **Tool-as-Step**: Use `createToolStep()` from `../../utils/workflow-factory` to use tools directly as workflow steps

## ✅ **CORRECT Usage Examples**:

**Agent Creation:**
```typescript
import { createAgent } from '../../utils/agent-factory';
import { myTools } from './tools';

export const myAgent = createAgent({
  name: 'MyAgent',
  instructions: 'You are a helpful agent...',
  tools: myTools,
  // memory and model (gemini-flash-latest) are automatically provided
});
```

**Tool Creation:**
```typescript
import { createTool } from '../../utils/tool-factory';
import { z } from 'zod';

export const myTool = createTool({
  id: 'my-tool-action',
  description: 'Performs a specific action',
  inputSchema: z.object({ input: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  execute: async ({ context }) => ({ result: context.input }),
});
```

**Workflow Creation:**
```typescript
import { createWorkflow, createStep, createAgentStep, createToolStep } from '../../utils/workflow-factory';
import { z } from 'zod';

// Traditional custom step
const myStep = createStep({
  id: 'myStep',
  description: 'A workflow step',
  inputSchema: z.object({}),
  outputSchema: z.object({ result: z.string() }),
  execute: async () => ({ result: 'done' }),
});

// Agent-as-step: Use an existing agent directly as a workflow step
const agentStep = createAgentStep({
  id: 'weather-step',
  description: 'Get weather using weather agent',
  agentName: 'weather',
  inputSchema: z.object({ location: z.string() }),
  outputSchema: z.object({ weather: z.string() }),
  prompt: ({ context }) => `Get weather for ${context.location}`,
});

// Tool-as-step: Use an existing tool directly as a workflow step
const toolStep = createToolStep({
  id: 'get-weather-step',
  description: 'Get current weather using tool',
  tool: getCurrentWeatherByCity,
  inputSchema: z.object({ location: z.string() }),
  inputTransform: ({ location }) => ({ cityName: location }),
});

export const myWorkflow = createWorkflow({
  id: 'myWorkflow',
  inputSchema: z.object({}),
  outputSchema: z.object({ result: z.string() }),
}).then(myStep);
```

## ❌ **INCORRECT Direct Usage**:
```typescript
// ❌ NEVER do this - bypasses Hey Jarvis defaults and standards
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { createWorkflow } from '@mastra/core/workflows';

export const badAgent = new Agent({ ... }); // ❌
export const badTool = createTool({ ... });  // ❌
export const badWorkflow = createWorkflow({ ... }); // ❌
```

## 🎯 **Factory Pattern Benefits**:
- **Consistent Defaults**: All agents automatically get `gemini-flash-latest` model and shared memory
- **Explicit API Configuration**: Google provider is explicitly configured with `HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY`
- **Future-Proof**: Easy to add logging, error handling, or observability across all entities
- **Type Safety**: Better TypeScript support with optional parameters for common defaults
- **Maintainability**: Single point of configuration for system-wide changes
- **Standards Enforcement**: Ensures all components follow Hey Jarvis conventions
- **YAGNI Compliance**: Factory methods are opinionated and only expose necessary customization options

## 📦 **Import Paths**:
Always use relative imports from your vertical to the utils:
- From `verticals/[vertical]/`: `../../utils/agent-factory`
- From `verticals/[vertical]/[sub-vertical]/`: `../../../utils/agent-factory`

**When creating new entities, ALWAYS use the Hey Jarvis factory functions instead of direct Mastra constructors.**
