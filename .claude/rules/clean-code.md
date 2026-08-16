---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---

# Clean Code

Essential clean code practices for the Hey Jarvis project.

## Variable Naming

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

## YAGNI (You Aren't Gonna Need It)

**Build only what is required right now.** Don't speculate about future needs.

Factory methods should be **opinionated with sensible defaults**, not extensive customization surfaces:

```typescript
// ✅ GOOD - Opinionated with defaults
export const createAgent = (config: AgentConfig) => {
  return new Agent({
    ...config,
    model: getModel('gemini-flash-latest'),
    memory: getSharedMemory(),
  });
};

// ❌ BAD - Too many options
export const createAgent = (config: AgentConfig & {
  customMemory?: Memory,
  customModel?: Model,
  customScorers?: Scorer[],
  customProcessors?: Processor[],
}) => { ... };
```

Add features ONLY when there is a concrete use case right now, multiple call sites show the same need, the cost of not having it is measurable, and you are actively building something that requires it.

**Red flags** that signal a YAGNI violation: "we might need this in the future", "what if someone wants to…", "just in case we need to…", "it's more flexible if we…".

## DRY (Don't Repeat Yourself)

Extract duplication when you see:

1. **Identical or very similar code** in 2+ places
2. **Same logic** with minor variations
3. **Related constants** defined multiple times

Duplicated functions go to shared utilities, repeated logic becomes reusable functions, copied constants get one central definition.

## ETC (Easy To Change)

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

### ETC vs YAGNI

They work together: make what you build easy to change (ETC), but don't build it before it's needed (YAGNI).
