---
paths:
  - "mcp/**"
---

# 🔧 **Implementation Guidelines**

> Part of [Jarvis Mastra AI Agents → Vertical Organization Conventions](mcp-vertical-organization-conventions.md). Paths in it are relative to `mcp/` unless they say otherwise.

## **Agent Creation Rules**
1. **Start Simple**: Begin with a single general agent (`agent.ts`)
2. **Split When Complex**: If >3 distinct responsibilities, consider multiple agents (`agents.ts`)
3. **Create Sub-Verticals**: If >4 agents, create specialized sub-verticals
4. **Maintain Focus**: Each agent should have ONE clear responsibility

## **Tool Organization Rules**
1. **Vertical Ownership**: All tools for a vertical go in its `tools.ts`
2. **No Cross-Vertical Tools**: Tools belong to exactly one vertical
3. **Shared Tools**: If truly shared, create a new `shared/` vertical
4. **API Integration**: Group related API calls in the same vertical
5. **CRITICAL - Tool Naming**: Tool ID, variable name, and export key must all be identical camelCase

**Tool Export Pattern:**
```typescript
// In tools.ts - Export using variable name directly (shorthand)
export const weatherTools = {
  getCurrentWeather,        // ✅ Shorthand for getCurrentWeather: getCurrentWeather
  getForecastByCity,        // ✅ ID, variable, and key all match
};

// In index.ts - Export the tools object
export { weatherTools } from './tools';

// In mastra/index.ts - Spread into Mastra config
tools: {
  ...weatherTools,  // Keys will be tool IDs (camelCase)
  ...shoppingTools,
}
```

## **Workflow Rules**
1. **Domain Alignment**: Workflows should match business processes, not technical steps
2. **Single Vertical**: Workflows should primarily use agents/tools from their own vertical
3. **Cross-Vertical**: If using multiple verticals, consider if it should be in a new vertical
