---
paths:
  - "mcp/mastra/verticals/**/tools.ts"
  - "mcp/mastra/utils/tool-factory.ts"
---

# Mastra Tools

**CRITICAL: ALWAYS use `createTool()` from `../../utils/tool-factory`.** Never use Mastra's tool constructors directly.

## Basic Pattern

```typescript
// In verticals/[vertical]/tools.ts
import { createTool } from '../../utils/tool-factory';
import { z } from 'zod';

export const myTool = createTool({
  id: 'myTool',  // camelCase matching the variable name
  description: 'Clear description of what this tool does',
  inputSchema: z.object({
    input: z.string().describe('Description of the input parameter'),
  }),
  outputSchema: z.object({
    result: z.string().describe('Description of the output'),
  }),
  execute: async ({ context }) => {
    return { result: context.input };
  },
});
```

## Critical Naming Rule

**Tool ID, variable name, and export key must all be identical (camelCase).**

```typescript
// ✅ CORRECT — all three match
export const getCurrentWeather = createTool({
  id: 'getCurrentWeather',
  // ...
});

export const weatherTools = {
  getCurrentWeather,  // shorthand — key matches variable
};
```

```typescript
// ❌ INCORRECT — names don't match
export const fetchWeather = createTool({
  id: 'getCurrentWeather',              // ❌ doesn't match the variable
});

export const weatherTools = {
  'get-current-weather': getCurrentWeather,  // ❌ wrong key
};
```

Mastra's `/api/tools` endpoint requires tool keys to match their IDs — the object keys *become* the tool identifiers exposed by the API.

## Export Pattern

```typescript
// tools.ts
export const weatherTools = {
  getCurrentWeather,
  getForecastByCity,
};

// index.ts
export { weatherTools } from './tools';

// mastra/index.ts
tools: {
  ...weatherTools,
  ...shoppingTools,
}
```

## Schemas

Always use Zod schemas with `.describe()` on every field:

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

1. **One vertical**: each tool belongs to exactly one vertical
2. **No sharing**: don't reach across verticals for tools
3. **Shared vertical**: if a tool is genuinely shared, create a `shared/` vertical

## What NOT to Do

❌ Never import from `@mastra/core/tools` directly
❌ Never use kebab-case for tool IDs (use camelCase)
❌ Never mismatch tool ID, variable name, and export key
❌ Never skip input/output schemas
❌ Never cast the `execute` return value — let the `outputSchema` drive the type
