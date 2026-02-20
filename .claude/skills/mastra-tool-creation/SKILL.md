---
name: mastra-tool-creation
description: Factory pattern and conventions for creating Mastra tools
---

# Creating Mastra Tools

Use the Hey Jarvis factory pattern for creating all tools.

## Factory Function

**CRITICAL: ALWAYS use `createTool()` from `../../utils/tool-factory`**

Never use Mastra's tool constructors directly.

## Basic Pattern

```typescript
// In verticals/[vertical]/tools.ts
import { createTool } from '../../utils/tool-factory';
import { z } from 'zod';

export const myTool = createTool({
  id: 'myTool',  // camelCase matching variable name
  description: 'Clear description of what this tool does',
  inputSchema: z.object({
    input: z.string().describe('Description of the input parameter'),
  }),
  outputSchema: z.object({
    result: z.string().describe('Description of the output'),
  }),
  execute: async ({ context }) => {
    // Implementation here
    return { result: context.input };
  },
});
```

## Critical Naming Rules

**MUST MATCH**: Tool ID, variable name, and export key must all be identical:

```typescript
// ✅ CORRECT - All names match (camelCase)
export const getCurrentWeather = createTool({
  id: 'getCurrentWeather',  // Matches variable name
  // ... config
});

export const weatherTools = {
  getCurrentWeather,  // Shorthand - key matches variable
};
```

```typescript
// ❌ INCORRECT - Names don't match
export const fetchWeather = createTool({
  id: 'getCurrentWeather',  // ❌ Doesn't match variable
  // ... config
});

export const weatherTools = {
  'get-current-weather': getCurrentWeather,  // ❌ Wrong key
};
```

## Why Naming Matters

Mastra's `/api/tools` endpoint requires tool keys to match their tool IDs. The object keys become the tool identifiers used by the API.

## Tool Export Pattern

```typescript
// Export tools using variable name directly (shorthand)
export const weatherTools = {
  getCurrentWeather,        // ✅ Shorthand
  getForecastByCity,        // ✅ ID, variable, key all match
};

// Then in index.ts
export { weatherTools } from './tools';

// Then in mastra/index.ts
tools: {
  ...weatherTools,  // Keys become tool IDs
  ...shoppingTools,
}
```

## Input/Output Schemas

Always use Zod schemas with descriptions:

```typescript
inputSchema: z.object({
  cityName: z.string().describe('Name of the city'),
  units: z.enum(['metric', 'imperial']).optional().describe('Temperature units'),
}),
outputSchema: z.object({
  temperature: z.number().describe('Current temperature'),
  condition: z.string().describe('Weather condition'),
}),
```

## Tool Ownership

1. **One Vertical**: Each tool belongs to exactly one vertical
2. **No Sharing**: Don't share tools across verticals
3. **Create Shared Vertical**: If truly shared, create a `shared/` vertical

## What NOT to Do

❌ Never import from `@mastra/core/tools` directly
❌ Never use kebab-case for tool IDs (use camelCase)
❌ Never mismatch tool ID and variable name
❌ Never skip input/output schemas
