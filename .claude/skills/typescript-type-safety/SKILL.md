---
name: typescript-type-safety
description: TypeScript type safety guidelines. Use this when writing TypeScript code, especially when handling errors or unknown data types.
---

# TypeScript Type Safety

**CRITICAL: Never use `any` type** - it defeats TypeScript's purpose.

## Rules

1. **Use proper types** for all data structures
2. **Use `unknown`** for truly unknown data, then narrow with type guards
3. **Use type assertions sparingly** and only when verified
4. **Enable strict mode** in tsconfig.json

## Error Handling

❌ **BAD - Using `any`:**
```typescript
server.on('error', (error: any) => {
  console.error('Server error:', error.message);
  if (error.details) {
    console.error('Details:', error.details.message);
  }
});
```

✅ **GOOD - Proper Type Assertion:**
```typescript
server.on('error', (error) => {
  const typedError = error as Error & {
    details?: { message?: string };
  };
  console.error('Server error:', typedError.message);
  if (typedError.details?.message) {
    console.error('Details:', typedError.details.message);
  }
});
```

✅ **EVEN BETTER - Type Guard:**
```typescript
function isErrorWithDetails(error: unknown): error is Error & { details: { message: string } } {
  return error instanceof Error &&
    typeof (error as any).details === 'object' &&
    typeof (error as any).details.message === 'string';
}

server.on('error', (error) => {
  console.error('Server error:', error instanceof Error ? error.message : String(error));
  if (isErrorWithDetails(error)) {
    console.error('Details:', error.details.message);
  }
});
```

## Why `any` is Problematic

- Disables all TypeScript checking
- No autocomplete in IDE
- Typos caught only at runtime
- Makes refactoring dangerous
- Defeats the purpose of TypeScript

## When to Use Type Assertions

- Only after verifying the shape/type at runtime
- When TypeScript can't infer but you know the type
- Use `as` assertions, not angle brackets
- Document why the assertion is safe
