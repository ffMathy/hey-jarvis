---
paths:
  - "mcp/**"
---

# 🎯 **Naming Conventions**

> Part of [Jarvis Mastra AI Agents → Vertical Organization Conventions](mcp-vertical-organization-conventions.md). Paths in it are relative to `mcp/` unless they say otherwise.

## **File Naming**
- **Single agent**: `agent.ts` (e.g., `weather/agent.ts`)
- **Multiple agents**: `agents.ts` (e.g., `shopping/agents.ts`)
- **Tools**: Always `tools.ts`
- **Shortcuts**: Always `shortcuts.ts` (optional - for cross-vertical tool re-use)
- **Workflows**: Always `workflows.ts`
- **Exports**: Always `index.ts`

## **Agent Naming**
- **General agents**: `[vertical]Agent` (e.g., `weatherAgent`, `recipeSearchAgent`)
- **Specialized agents**: `[vertical][Purpose]Agent` (e.g., `mealPlanSelectorAgent`, `shoppingListSummaryAgent`)

## **Tool Naming**
- **Tool IDs**: Always use `camelCase` matching the variable name (e.g., `getCurrentWeather`, `findProductInCatalog`)
- **Tool variable names**: Must exactly match their tool ID (e.g., tool ID `getCurrentWeather` = variable name `getCurrentWeather`)
- **Tool exports**: **CRITICAL** - Export tools using the variable name directly as shorthand
- **Tool collection exports**: Use `[vertical]Tools` (e.g., `weatherTools`, `cookingTools`)

**Example - CORRECT Tool Naming:**
```typescript
// ✅ CORRECT: Variable name matches tool ID (camelCase)
export const getCurrentWeather = createTool({
  id: 'getCurrentWeather',  // camelCase ID matching variable name
  // ... tool config
});

export const weatherTools = {
  getCurrentWeather,  // ✅ Shorthand - key and value use same name
  getForecast,
};
```

**Example - INCORRECT Tool Naming:**
```typescript
// ❌ INCORRECT: Variable name doesn't match ID
export const fetchWeather = createTool({
  id: 'getCurrentWeather',  // ❌ ID doesn't match variable name
  // ... tool config
});

// ❌ INCORRECT: Using different key than variable name
export const weatherTools = {
  'get-current-weather': getCurrentWeather,  // ❌ Wrong key format!
};
```

**Why This Matters:**
Mastra's `/api/tools` endpoint requires tool keys to match their tool IDs. When tools are registered in the Mastra instance, the object keys become the tool identifiers used by the API. The tool ID, variable name, and export key must all be identical for tools to be properly exposed.

## **Workflow Naming**
- **Workflow IDs**: Use `camelCase` matching the export name (e.g., `weatherMonitoringWorkflow`)
- **Workflow exports**: Use descriptive names (e.g., `weatherMonitoringWorkflow`, `weeklyMealPlanningWorkflow`)
