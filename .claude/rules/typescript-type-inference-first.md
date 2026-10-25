---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# Type Inference First

> Part of [TypeScript](typescript.md).

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
