---
name: clean-code
description: Essential clean code practices including naming, comments, and structure
---

# Clean Code Principles

Follow these essential clean code practices for the Hey Jarvis project.

## Variable Naming

**CRITICAL: Never shorten variable names** - clarity is more important than brevity.

### Rules

Variable names should be:
- Self-documenting and immediately understandable
- Longer descriptive names over short abbreviated ones
- Clear about what they represent

### Examples

✅ **GOOD - Full descriptive names:**
```typescript
const requirements = [...];
const acceptanceCriteria = [...];
const implementation = {...};
const dependencies = [...];
```

❌ **BAD - Shortened abbreviations:**
```typescript
const req = [...];      // ❌ NEVER
const ac = [...];       // ❌ NEVER
const impl = {...};     // ❌ NEVER
const deps = [...];     // ❌ NEVER
```

### Special Cases

The only acceptable abbreviations are industry-standard terms:
- `id` (identifier)
- `url` (Uniform Resource Locator)
- `api` (Application Programming Interface)
- `html`, `css`, `json` (well-known formats)
- `i`, `j`, `k` (only in short loop contexts)

## YAGNI Principle (You Aren't Gonna Need It)

**Avoid adding functionality or configuration options until they are actually needed.**

### Core Philosophy

Build only what is required right now. Don't speculate about future needs.

### Application Areas

**Factory Methods:**
- Should be **opinionated** with sensible defaults
- NOT extensive customization options
- Focus on the common case

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

### When to Add Complexity

Add features ONLY when:
1. There's a **concrete use case** right now
2. Multiple instances show the **same need**
3. The cost of not having it is **measurable**
4. You're **actively building** something that requires it

### Red Flags

Watch for these phrases that signal YAGNI violations:
- "We might need this in the future"
- "What if someone wants to..."
- "Just in case we need to..."
- "It's more flexible if we..."

## DRY Principle (Don't Repeat Yourself)

**Avoid duplicating code, logic, or knowledge throughout the codebase.**

### What to DRY

- **Duplicated functions**: Extract to shared utilities
- **Repeated logic**: Create reusable functions
- **Copied constants**: Define once in a central location
- **Similar patterns**: Abstract common behavior

### When to Extract

Extract duplication when you see:
1. **Identical or very similar code** in 2+ places
2. **Same logic** with minor variations
3. **Related constants** defined multiple times

## ETC Principle (Easy To Change)

**Write code that is easy to modify, extend, and adapt to changing requirements.**

### How to Apply

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

**Use configuration over code:**
```typescript
// ✅ GOOD - Configurable
export const TIMEOUTS = {
  connect: 60,
  read: 300,
  retry: 60,
};

// ❌ BAD - Hard-coded
const timeout = 60; // Scattered throughout code
```

### ETC vs YAGNI

- **ETC**: Make code easy to change when needed
- **YAGNI**: Don't add features before they're needed

These work together:
- ✅ Write simple, well-structured code (ETC + YAGNI)
- ❌ Don't add speculative features (YAGNI)
- ✅ But make what you build easy to extend (ETC)
