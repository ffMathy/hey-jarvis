---
paths:
  - "mcp/mastra/verticals/**/agent.ts"
  - "mcp/mastra/verticals/**/agents.ts"
  - "mcp/mastra/utils/agent-factory.ts"
---

# Mastra Agents

**CRITICAL: ALWAYS use `createAgent()` from `../../utils/agent-factory`.** Never use Mastra's constructors directly.

## Basic Pattern

```typescript
// In verticals/[vertical]/agent.ts
import { createAgent } from '../../utils/agent-factory';
import { myTools } from './tools';

export async function getMyAgent(): Promise<Agent> {
  return createAgent({
    name: 'MyAgent',
    instructions: 'You are a helpful agent that...',
    tools: myTools,
    // memory and model (gemini-flash-latest) automatically provided
  });
}
```

## What the Factory Provides

- **Model**: `gemini-flash-latest` from Google
- **Memory**: shared LibSQL storage
- **Error reporting**: automatic GitHub issue creation on errors
- **Observability**: AI tracing and token usage tracking
- **Scorers**: quality evaluation (answer relevancy, hallucination, etc.)

## Naming Conventions

- **General agents**: `[vertical]Agent` (e.g. `weatherAgent`)
- **Specialized agents**: `[vertical][Purpose]Agent` (e.g. `mealPlanSelectorAgent`)
- **Export function**: `get[Agent]` (e.g. `getWeatherAgent`)

## Steps to Add a New Agent

1. **Create the vertical directory**: `mcp/mastra/verticals/[name]/`
2. **Create tools** in `tools.ts`
3. **Create the agent** with the factory in `agent.ts` (or `agents.ts` for several)
4. **Export** from the vertical's `index.ts`
5. **Register** in `mcp/mastra/verticals/index.ts`
6. **Register in Mastra** in `mcp/mastra/index.ts`
7. **Document** in `mcp/AGENTS.md`

```typescript
// In mastra/index.ts
import { getMyAgent } from './verticals';

export const mastra = new Mastra({
  agents: {
    myAgent: await getMyAgent(),
  },
});
```

## What NOT to Do

❌ Never import from `@mastra/core/agent` directly
❌ Never create agents without the factory
❌ Never override memory or model configuration the factory already supplies
