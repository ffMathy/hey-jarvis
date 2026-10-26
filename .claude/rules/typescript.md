---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript

**CRITICAL: Never use `any` type** - it defeats TypeScript's purpose.
**CRITICAL: Never add `biome-ignore` comments** - fix the underlying issue instead.
**CRITICAL: Prefer type inference over casting** - casts hide bugs and break on upgrades.

## Its rules

Each topic is a rule of its own, under the same paths:

- [Type Inference First](typescript-type-inference-first.md)
- [Casting is a Last Resort](typescript-casting-is-a-last-resort.md)
- [Error Handling](typescript-error-handling.md)
- [NEVER Double-Cast](typescript-never-double-cast.md)
- [VS Code IDE Warnings and Errors](typescript-vs-code-ide-warnings-and-errors.md)

## Rules

1. **Let TypeScript infer types** whenever possible — don't annotate what the compiler already knows
2. **Use proper types** for all data structures
3. **Use `unknown`** for truly unknown data, then narrow with type guards
4. **Avoid type assertions (`as`)** — they are a last resort, not a first fix
5. **Enable strict mode** in tsconfig.json
6. **Never add `biome-ignore` comments** — resolve the lint issue properly
7. **Use `z.unknown()` instead of `z.any()`** in Zod schemas
8. **Use `z.enum([...])` for known string unions** instead of `z.string()`

## Why `any` is Problematic

- Disables all TypeScript checking
- No autocomplete in IDE
- Typos caught only at runtime
- Makes refactoring dangerous
- Defeats the purpose of TypeScript

## Why Casting is Problematic

- **Silences real errors** — the compiler was warning you for a reason
- **Breaks on upgrades** — when a library changes its types, casts hide the incompatibility
- **No runtime safety** — `as` is erased at runtime, the value could be anything
- **Masks design issues** — if you need a cast, the code's types are likely wrong

## When Casting is Acceptable (Last Resort)

Only use `as` when ALL of these are true:
- Type narrowing, generics, `satisfies`, and schema validation don't work
- You've verified the shape/type at runtime or it's guaranteed by the API contract
- You add a comment explaining **why** the cast is necessary and safe
- You use `as` syntax (not angle brackets)

## Runtime Validation

For external data or workflow chain inputs, use Zod validation:
```typescript
// WRONG
const data = externalAPI.getData() as any;

// RIGHT
const schema = z.object({ name: z.string() });
const data = schema.parse(externalAPI.getData());
```

## Type Narrowing

Use TypeScript's type narrowing features:
```typescript
// WRONG
const value = data.value as string;

// RIGHT
if (typeof data.value === 'string') {
  const value = data.value; // TypeScript knows it's a string
}
```
