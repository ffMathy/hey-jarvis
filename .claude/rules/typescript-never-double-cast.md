---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# NEVER Double-Cast

> Part of [TypeScript](typescript.md).

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
