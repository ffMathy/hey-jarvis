---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---

# Variable Naming

> Part of [Clean Code](clean-code.md).

**CRITICAL: Never shorten variable names** — clarity beats brevity.

Names should be self-documenting, immediately understandable, and clear about what they represent.

✅ **GOOD — full descriptive names:**

```typescript
const requirements = [...];
const acceptanceCriteria = [...];
const implementation = {...};
const dependencies = [...];
```

❌ **BAD — shortened abbreviations:**

```typescript
const req = [...];      // ❌ NEVER
const ac = [...];       // ❌ NEVER
const impl = {...};     // ❌ NEVER
const deps = [...];     // ❌ NEVER
```

The only acceptable abbreviations are industry-standard terms: `id`, `url`, `api`, `html`, `css`, `json`, and `i`/`j`/`k` in short loop contexts.
