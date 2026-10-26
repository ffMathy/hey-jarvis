---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# Error Handling

> Part of [TypeScript](typescript.md).

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
