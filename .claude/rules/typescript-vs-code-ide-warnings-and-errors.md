---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# VS Code IDE Warnings and Errors

> Part of [TypeScript](typescript.md).

**CRITICAL: All TypeScript errors and warnings reported by VS Code must be resolved.** Do not leave red or yellow squiggles unaddressed.

## Treat IDE Diagnostics as Failures

- **Red squiggles (errors)** — must be fixed before committing; they indicate type errors, missing imports, or invalid syntax
- **Yellow squiggles (warnings)** — must be resolved; they often indicate `any` usage, unused variables, or deprecated APIs
- **The Problems panel** (`Ctrl+Shift+M`) — check it and clear all entries related to files you've touched

## Common Causes and Fixes

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

## Biome Lint Warnings

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

## TypeScript Compiler Checks

Run the TypeScript compiler directly to surface all errors across the project:
```bash
bunx tsc --noEmit
```

Fix every reported error. Never use `// @ts-ignore` or `// @ts-expect-error` as a workaround — these hide real problems and should only be used as a last resort with a comment explaining why.
