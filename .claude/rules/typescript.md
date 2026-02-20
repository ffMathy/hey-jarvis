---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript

**CRITICAL: Never use `any` type** - it defeats TypeScript's purpose.
**CRITICAL: Never add `biome-ignore` comments** - fix the underlying issue instead.
**CRITICAL: Prefer type inference over casting** - casts hide bugs and break on upgrades.

## Rules

1. **Let TypeScript infer types** whenever possible — don't annotate what the compiler already knows
2. **Use proper types** for all data structures
3. **Use `unknown`** for truly unknown data, then narrow with type guards
4. **Avoid type assertions (`as`)** — they are a last resort, not a first fix
5. **Enable strict mode** in tsconfig.json
6. **Never add `biome-ignore` comments** — resolve the lint issue properly
7. **Use `z.unknown()` instead of `z.any()`** in Zod schemas
8. **Use `z.enum([...])` for known string unions** instead of `z.string()`

## Type Inference First

TypeScript's inference engine is powerful. Let it do its job.

❌ **BAD - Unnecessary annotation:**
```typescript
const name: string = 'hello';
const items: string[] = ['a', 'b'];
const result: ReturnType<typeof myFn> = myFn();
```

✅ **GOOD - Let TypeScript infer:**
```typescript
const name = 'hello';
const items = ['a', 'b'];
const result = myFn();
```

## Casting is a Last Resort

**Casting (`as`) silences the compiler instead of fixing the problem.** Before reaching for a cast:

1. **Check if the type can be inferred** from context or return types
2. **Use type narrowing** (`typeof`, `instanceof`, `in`, discriminated unions)
3. **Use type guards** for complex shapes
4. **Add proper generic parameters** to functions/classes
5. **Use `satisfies`** to validate a value matches a type without widening
6. **Only then**, if none of the above work, use `as` with a comment explaining why

❌ **BAD - Casting to fix a type error:**
```typescript
const value = getData() as MyType;
const config = response.data as Config;
```

✅ **GOOD - Narrow or validate instead:**
```typescript
const value = getData(); // returns MyType already if typed correctly
const config = configSchema.parse(response.data); // runtime validation
```

✅ **GOOD - Use `satisfies` for compile-time validation:**
```typescript
const config = {
  port: 3000,
  host: 'localhost',
} satisfies ServerConfig;
```

## Error Handling

❌ **BAD - Using `any`:**
```typescript
server.on('error', (error: any) => {
  console.error('Server error:', error.message);
});
```

✅ **GOOD - Type Guard:**
```typescript
function isErrorWithDetails(error: unknown): error is Error & { details: { message: string } } {
  return error instanceof Error &&
    typeof (error as Record<string, unknown>).details === 'object';
}
```

✅ **ACCEPTABLE (last resort) - Type Assertion with justification:**
```typescript
server.on('error', (error) => {
  // EventEmitter types error as unknown but Express always passes Error instances
  const typedError = error as Error & { details?: { message?: string } };
  console.error('Server error:', typedError.message);
});
```

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

## NEVER Double-Cast

**CRITICAL: Never use `as unknown as SomeType`** — this is always wrong.

Double-casting (`as unknown as X`) bypasses TypeScript entirely and hides a real type mismatch.

❌ **BAD — Double-cast defeats all type safety:**
```typescript
const result = value as unknown as TargetType;
```

If you need `as unknown as X`, it means the types are genuinely incompatible — find the **real** root cause:
- Are you importing types from the wrong source? (e.g., importing from `'ai'` v6 when the API expects Mastra's bundled AI SDK v4 types)
- Does the root data shape need to change?

✅ **GOOD — Use the exact type the API expects, imported from the correct source:**
```typescript
// When @mastra/core agent.stream() expects CoreMessageV4, import from @mastra/core directly
import type { CoreMessageV4 } from '@mastra/core/agent/message-list';
const result = value as CoreMessageV4[];
```

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

## VS Code IDE Warnings and Errors

**CRITICAL: All TypeScript errors and warnings reported by VS Code must be resolved.** Do not leave red or yellow squiggles unaddressed.

### Treat IDE Diagnostics as Failures

- **Red squiggles (errors)** — must be fixed before committing; they indicate type errors, missing imports, or invalid syntax
- **Yellow squiggles (warnings)** — must be resolved; they often indicate `any` usage, unused variables, or deprecated APIs
- **The Problems panel** (`Ctrl+Shift+M`) — check it and clear all entries related to files you've touched

### Common Causes and Fixes

**Unresolved imports:**
```typescript
// BAD — import path does not exist
import { foo } from './nonexistent';

// GOOD — verify the module exists and the path is correct
import { foo } from './existing-module';
```

**Implicit `any` from missing types:**
```typescript
// BAD — parameter implicitly has type 'any'
function process(data) { ... }

// GOOD — add explicit type or use generics
function process(data: ProcessInput) { ... }
function process<T>(data: T) { ... }
```

**Unused variables (reported as warnings):**
```typescript
// BAD — declared but never read
const unused = computeValue();

// GOOD — either use it or remove it
const result = computeValue();
doSomething(result);
```

**Missing return types when inference fails:**
```typescript
// BAD — return type cannot be inferred, IDE shows error
function getConfig() {
  if (condition) return { a: 1 };
  // missing return path
}

// GOOD — cover all paths or annotate explicitly
function getConfig(): Config | undefined {
  if (condition) return { a: 1 };
  return undefined;
}
```

### Biome Lint Warnings

This project uses Biome for linting. Never suppress Biome warnings with `biome-ignore` — fix the root cause instead:

```typescript
// BAD
// biome-ignore lint/suspicious/noExplicitAny: too lazy to fix
const data: any = fetch();

// GOOD — use proper types
const data: ApiResponse = await fetchTyped();
```

To auto-fix safe Biome issues:
```bash
bunx biome check --write .
```

### TypeScript Compiler Checks

Run the TypeScript compiler directly to surface all errors across the project:
```bash
bunx tsc --noEmit
```

Fix every reported error. Never use `// @ts-ignore` or `// @ts-expect-error` as a workaround — these hide real problems and should only be used as a last resort with a comment explaining why.
