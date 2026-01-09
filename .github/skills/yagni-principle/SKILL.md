---
name: yagni-principle
description: You Aren't Gonna Need It principle for avoiding unnecessary features and complexity. Use this when designing new features or refactoring code.
---

# YAGNI Principle (You Aren't Gonna Need It)

**Avoid adding functionality or configuration options until they are actually needed.**

## Core Philosophy

Build only what is required right now. Don't speculate about future needs.

## Application Areas

### Factory Methods
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

### Configuration
- **Only expose parameters** that are necessary for core functionality
- Don't add "just in case" configuration options
- Add options when users actually need them

### Features
- **Don't implement speculative features** or "what if" scenarios
- Build features when there's a concrete use case
- Avoid premature abstraction

### Dependencies
- **Don't add libraries** until they solve an actual problem
- Don't add dependencies "because we might need them"
- Add packages when the need is proven

## Examples

### ❌ BAD - Speculative Features

```typescript
// Adding features "just in case"
interface AgentConfig {
  name: string;
  mode?: 'sync' | 'async';           // Not needed yet
  retryPolicy?: RetryPolicy;         // No retry use case
  circuitBreaker?: CircuitBreaker;   // No failures to handle
  cacheStrategy?: CacheStrategy;     // No caching need
}
```

### ✅ GOOD - Minimal Configuration

```typescript
// Only what's actually used
interface AgentConfig {
  name: string;
  instructions: string;
  tools: Record<string, Tool>;
  // Add more when needed
}
```

## When to Add Complexity

Add features ONLY when:
1. There's a **concrete use case** right now
2. Multiple instances show the **same need**
3. The cost of not having it is **measurable**
4. You're **actively building** something that requires it

## Benefits

- **Less code**: Fewer lines to maintain and test
- **Faster development**: Don't spend time on unused features
- **Easier understanding**: Simpler code is easier to read
- **Better design**: Requirements clarify as you build

## Red Flags

Watch for these phrases that signal YAGNI violations:
- "We might need this in the future"
- "What if someone wants to..."
- "Just in case we need to..."
- "It's more flexible if we..."
- "Let's make it configurable so..."

## Refactoring

If you realize you need something later:
1. **Add it then** - not before
2. **Keep changes minimal** - only what's needed
3. **Test the new use case** - verify it works
4. **Update documentation** - explain the new option

## YAGNI ≠ Poor Design

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
