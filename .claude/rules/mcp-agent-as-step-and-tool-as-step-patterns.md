---
paths:
  - "mcp/**"
---

# Agent-as-Step and Tool-as-Step Patterns

> Part of [Jarvis Mastra AI Agents](mcp.md). Paths in it are relative to `mcp/` unless they say otherwise.

## 🔄 **Modern Workflow Architecture**
All workflows in this project have been converted to use **agent-as-step** and **tool-as-step** patterns, which provide:

- **Better Reusability**: Existing agents and tools become reusable workflow components
- **Simplified Logic**: Less custom step code, more declarative workflow composition  
- **Consistent Behavior**: Agent and tool behavior is the same whether used standalone or in workflows
- **Easier Maintenance**: Changes to agents/tools automatically benefit all workflows using them

## 🤖 **Agent-as-Step Pattern**
Uses existing agents directly as workflow steps:

```typescript
const weatherStep = createAgentStep({
  id: 'weather-check',
  description: 'Get weather using weather agent',
  agentName: 'weather',
  inputSchema: z.object({ location: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  prompt: ({ context }) => `Get weather for ${context.location}`,
  structuredOutput: { // Optional for JSON responses
    schema: z.object({ temperature: z.number(), condition: z.string() })
  }
});
```

**Benefits:**
- Leverages existing agent intelligence and tool access
- Consistent prompting and response handling
- Automatic scoring and evaluation (when enabled)
- Memory integration

## 🔧 **Tool-as-Step Pattern** 
Uses existing tools directly as workflow steps:

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
- Direct tool execution without agent overhead
- Precise input/output transformation
- Better for deterministic operations
- Faster execution for simple operations

## 🌊 **Converted Workflows**

### **Weather Monitoring Workflow**
- **Before**: Custom step with manual agent calling
- **After**: Agent-as-step pattern with weather agent
- **Improvement**: Simplified from 2 custom steps to 1 agent step + 1 transform step

### **Weekly Meal Planning Workflow**  
- **Before**: Complex custom steps calling multiple agents
- **After**: Tool-as-step for recipe fetching + agent-as-step for meal planning
- **Improvement**: Tool-as-step for `getRecipeCatalog`, agent-as-step for `mealPlanRecipeSelector` and `mealPlanGenerator`
- **Token budget**: Recipes are chosen from the compact catalogue and only the chosen ones are fetched in full with `getRecipeById`, so no prompt ever carries every recipe
- **Baby tasting**: The household's baby is learning to eat and tastes the adults' dinner. `BABY_TASTING_GUIDELINES` in `cooking/workflows.ts` (from "Mad til børn", 2025) goes to both `mealPlanRecipeSelector` and `mealPlanGenerator`. It covers mild heat, little salt, no honey, no large predatory fish, and choking hazards. The generator moves chili and salt to after the baby's portion is set aside, and adds a "Til baby:" direction to each recipe

### **Shopping List Workflow**
- **Before**: 5 complex custom steps with inline agent creation
- **After**: Mix of tool-as-step and agent-as-step patterns
- **Improvement**: Tool-as-step for cart operations, agent-as-step for extraction/processing/summarization

## 📋 **Pattern Selection Guidelines**

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
