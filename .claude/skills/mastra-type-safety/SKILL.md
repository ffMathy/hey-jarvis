---
name: mastra-type-safety
description: Infer types in Mastra code — never cast to fix version upgrade breakages
---

# Mastra Type Safety

**CRITICAL: Never use type casts (`as`) to fix Mastra type errors** — especially after version bumps. Casts are hacks that hide real incompatibilities and will break silently at runtime.

## Core Principle

When Mastra upgrades change types, **adapt your code to the new types** instead of casting the old shapes into the new ones. If a type changed, the API contract changed — your code must change too.

## Rules

1. **Let types be inferred** from Mastra's SDK — don't annotate return types of `createTool()`, `createAgent()`, workflow steps, etc.
2. **Never cast to fix a version bump** — if types broke, the fix is updating your code, not silencing the compiler
3. **Use `satisfies`** when you want to ensure a config object matches a Mastra type without losing inference
4. **Trust the SDK's generics** — Mastra tools, agents, and workflows carry rich generic types; let them flow through
5. **Use Zod schemas** for runtime validation at boundaries, not casts

## Version Bump Workflow

When upgrading Mastra and types break:

1. **Read the changelog / migration guide** to understand what changed
2. **Fix the root cause** — update your code to match the new API surface
3. **Never cast the old shape** into the new type to make errors go away
4. **Run tests** to verify behavior matches the new contract

❌ **BAD - Casting to silence a version bump breakage:**
```typescript
// Mastra v2 changed StepResult shape, so we cast to make it compile
const result = step.output as unknown as LegacyStepResult;
```

❌ **BAD - Casting tool execute return:**
```typescript
export const myTool = createTool({
  id: 'my-tool',
  execute: async ({ context }) => {
    const data = await fetchData();
    return data as ToolOutput; // cast hides shape mismatch
  },
});
```

✅ **GOOD - Let types flow from the SDK:**
```typescript
export const myTool = createTool({
  id: 'my-tool',
  inputSchema: myInputSchema,
  outputSchema: myOutputSchema,
  execute: async ({ context }) => {
    const data = await fetchData();
    return data; // SDK infers the output type from outputSchema
  },
});
```

✅ **GOOD - Use `satisfies` for config objects:**
```typescript
const agentConfig = {
  name: 'MyAgent',
  instructions: 'You are a helpful agent.',
  tools: myTools,
} satisfies Parameters<typeof createAgent>[0];
```

## Mastra-Specific Patterns

### Tool Definitions

Let the `inputSchema` and `outputSchema` drive the types:

```typescript
const inputSchema = z.object({ query: z.string() });
const outputSchema = z.object({ results: z.array(z.string()) });

export const searchTool = createTool({
  id: 'search',
  description: 'Search for items',
  inputSchema,
  outputSchema,
  execute: async ({ context }) => {
    // context.query is inferred as string from inputSchema
    // return type is inferred from outputSchema
    return { results: await search(context.query) };
  },
});
```

### Workflow Steps

Don't annotate step input/output types — they're inferred from the schema and previous steps:

```typescript
const myWorkflow = createWorkflow({
  id: 'my-workflow',
  inputSchema: z.object({ prompt: z.string() }),
  outputSchema: z.object({ answer: z.string() }),
})
  .then(stepOne)  // input/output types inferred
  .then(stepTwo)  // receives stepOne's output type automatically
  .commit();
```

### Agent Responses

Don't cast agent generation results:

```typescript
// WRONG
const response = await agent.generate(prompt) as { text: string };

// RIGHT
const response = await agent.generate(prompt);
const text = response.text; // type is already known from the SDK
```

## Why This Matters for Mastra Specifically

- Mastra is in active development (v1 beta) — types change frequently
- Casts create **invisible tech debt** that accumulates across upgrades
- Mastra's type system carries important constraints (schema validation, step chaining) that casts bypass
- When types break on upgrade, it's a signal your code needs updating — not silencing
