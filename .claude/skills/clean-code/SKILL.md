---
name: clean-code
description: Clean code principles including descriptive variable naming and YAGNI (You Aren't Gonna Need It). Use this when writing or refactoring code.
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

### Rationale

- **Readability**: Code is read far more often than written
- **Maintainability**: Future developers will understand the code
- **Self-Documentation**: Good names reduce the need for comments
- **IDE Support**: Modern IDEs have autocomplete - typing long names is not a burden

### Special Cases

The only acceptable abbreviations are industry-standard terms:
- `id` (identifier)
- `url` (Uniform Resource Locator)
- `api` (Application Programming Interface)
- `html`, `css`, `json` (well-known formats)
- `i`, `j`, `k` (only in short loop contexts)

### Apply Consistently

This applies to:
- Variable names
- Function names
- Parameter names
- Class/interface names
- File names

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
    model: getModel('gemini-flash-latest'),  // Sensible default
    memory: getSharedMemory(),               // Standard memory
  });
};

// ❌ BAD - Too many options
export const createAgent = (config: AgentConfig & {
  customMemory?: Memory,
  customModel?: Model,
  customScorers?: Scorer[],
  customProcessors?: Processor[],
  // ... 10 more options
}) => { ... };
```

**Configuration:**
- Only expose parameters necessary for core functionality
- Don't add "just in case" configuration options
- Add options when users actually need them

**Features:**
- Don't implement speculative features or "what if" scenarios
- Build features when there's a concrete use case
- Avoid premature abstraction

**Dependencies:**
- Don't add libraries until they solve an actual problem
- Add packages when the need is proven

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
- "Let's make it configurable so..."

### YAGNI ≠ Poor Design

YAGNI doesn't mean:
- ❌ Skip error handling
- ❌ Ignore edge cases in current features
- ❌ Write unmaintainable code
- ❌ Avoid proper abstractions for current needs

YAGNI means:
- ✅ Build what you need now
- ✅ Design for current requirements
- ✅ Add complexity when needed
- ✅ Keep it simple until proven otherwise

## DRY Principle (Don't Repeat Yourself)

**Avoid duplicating code, logic, or knowledge throughout the codebase.**

### Core Philosophy

Every piece of knowledge should have a single, unambiguous representation in the system.

### What to DRY

- **Duplicated functions**: Extract to shared utilities
- **Repeated logic**: Create reusable functions
- **Copied constants**: Define once in a central location
- **Similar patterns**: Abstract common behavior

### Examples

✅ **GOOD - Shared helper function:**
```typescript
// helpers/docker-helper.ts
export async function getContainerIP(): Promise<string> {
  // Implementation once
}

// test1.spec.ts
import { getContainerIP } from './helpers/docker-helper';

// test2.spec.ts
import { getContainerIP } from './helpers/docker-helper';
```

❌ **BAD - Duplicated code:**
```typescript
// test1.spec.ts
async function getContainerIP(): Promise<string> {
  // Same implementation
}

// test2.spec.ts
async function getContainerIP(): Promise<string> {
  // Same implementation duplicated
}
```

### When to Extract

Extract duplication when you see:
1. **Identical or very similar code** in 2+ places
2. **Same logic** with minor variations
3. **Related constants** defined multiple times

### Where to Extract To

- **Shared utilities**: For general-purpose functions
- **Helper modules**: For domain-specific utilities
- **Configuration files**: For constants and settings
- **Base classes/types**: For shared behavior

### Benefits

- **Single source of truth**: Changes in one place affect all uses
- **Easier maintenance**: Fix bugs once, not in multiple places
- **Reduced errors**: Less code duplication means fewer mistakes
- **Better testability**: Test shared code once

## ETC Principle (Easy To Change)

**Write code that is easy to modify, extend, and adapt to changing requirements.**

### Core Philosophy

Good design should minimize the cost of change. Code should be flexible and adaptable.

### How to Apply

**Decouple components:**
```typescript
// ✅ GOOD - Loosely coupled
export function processData(data: Data, processor: DataProcessor) {
  return processor.process(data);
}

// ❌ BAD - Tightly coupled
export function processData(data: Data) {
  const processor = new SpecificProcessor(); // Hard-coded dependency
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

**Favor composition over inheritance:**
```typescript
// ✅ GOOD - Composable
export function createAgent(config: AgentConfig) {
  return {
    ...baseAgent,
    ...config,
  };
}

// ❌ BAD - Deep inheritance hierarchy
class BaseAgent extends SuperAgent extends MegaAgent { }
```

### Design for Change

Anticipate likely changes:
- **Configuration values**: Extract to constants
- **External dependencies**: Use interfaces/abstractions
- **Business logic**: Keep separate from infrastructure
- **Data formats**: Use adapters/transformers

### ETC vs YAGNI

- **ETC**: Make code easy to change when needed
- **YAGNI**: Don't add features before they're needed

These work together:
- ✅ Write simple, well-structured code (ETC + YAGNI)
- ❌ Don't add speculative features (YAGNI)
- ✅ But make what you build easy to extend (ETC)

### Red Flags

Watch for code that's hard to change:
- Many files need updates for a single feature
- Duplicated logic in multiple places (violates DRY)
- Hard-coded values scattered throughout
- Tight coupling between unrelated modules

## Benefits

- **Less code**: Fewer lines to maintain and test
- **Faster development**: Focus on what matters
- **Easier understanding**: Simpler, clearer code
- **Better design**: Requirements clarify as you build
- **Maintainability**: Changes are localized and safe
- **Flexibility**: Code adapts to new requirements easily
