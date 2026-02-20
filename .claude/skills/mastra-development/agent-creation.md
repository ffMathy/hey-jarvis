# Creating Mastra Agents

Use the Hey Jarvis factory pattern for creating all agents.

## Factory Function

**CRITICAL: ALWAYS use `createAgent()` from `../../utils/agent-factory`**

Never use Mastra's constructors directly.

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

The factory automatically includes:
- **Model**: `gemini-flash-latest` from Google
- **Memory**: Shared LibSQL storage
- **Error Reporting**: Automatic GitHub issue creation on errors
- **Observability**: AI tracing and token usage tracking
- **Scorers**: Quality evaluation (answer-relevancy, hallucination, etc.)

## File Structure

When creating a new vertical:

```
mastra/verticals/[vertical-name]/
├── agent.ts          # Single agent (if simple)
├── agents.ts         # Multiple agents (if complex)
├── tools.ts          # All tools for this vertical
├── workflows.ts      # All workflows
└── index.ts          # Export everything
```

## Naming Conventions

- **General agents**: `[vertical]Agent` (e.g., `weatherAgent`)
- **Specialized agents**: `[vertical][Purpose]Agent` (e.g., `mealPlanSelectorAgent`)
- **Export function**: `get[Agent]` (e.g., `getWeatherAgent`)

## Steps to Add New Agent

1. **Create vertical directory**: `mkdir -p mastra/verticals/[name]`
2. **Create tools**: Define tools in `tools.ts`
3. **Create agent**: Use factory in `agent.ts`
4. **Export**: Add exports to `index.ts`
5. **Register**: Update `mastra/verticals/index.ts`
6. **Register in Mastra**: Add to `mastra/index.ts`
7. **Document**: Update `mcp/AGENTS.md`

## Example Registration

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
❌ Never skip memory or model configuration
