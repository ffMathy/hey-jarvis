---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---

# ETC (Easy To Change)

> Part of [Clean Code](clean-code.md).

Write code that is easy to modify, extend, and adapt.

**Decouple components:**

```typescript
// ✅ GOOD - Loosely coupled
export function processData(data: Data, processor: DataProcessor) {
  return processor.process(data);
}

// ❌ BAD - Tightly coupled
export function processData(data: Data) {
  const processor = new SpecificProcessor();
  return processor.process(data);
}
```

**Use configuration over scattered literals:**

```typescript
// ✅ GOOD - Configurable
export const TIMEOUTS = {
  connect: 60,
  read: 300,
  retry: 60,
};

// ❌ BAD - Hard-coded and scattered throughout the code
const timeout = 60;
```

## ETC vs YAGNI

They work together: make what you build easy to change (ETC), but don't build it before it's needed (YAGNI).
