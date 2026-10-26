---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# Casting is a Last Resort

> Part of [TypeScript](typescript.md).

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
