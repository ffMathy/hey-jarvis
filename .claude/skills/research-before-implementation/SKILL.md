---
name: research-before-implementation
description: Mandatory research protocol before implementing any feature or making architectural decisions. Use this at the start of any implementation task.
---

# Research Before Implementation

**CRITICAL: ALWAYS perform web searches before starting any task.**

## Mandatory Protocol

Before implementing ANY feature, you MUST:

1. Perform **at minimum 1 web search** (more is better)
2. Search for:
   - Current best practices and patterns
   - Latest library versions and APIs
   - Security considerations and common pitfalls
   - Existing solutions and examples
   - Documentation and tutorials

## When to Search

✅ **ALWAYS search before:**
- Implementing any new feature
- Choosing a library or dependency
- Making architectural decisions
- Writing complex algorithms
- Working with unfamiliar APIs or frameworks
- Encountering errors or issues
- Being uncertain about best practices

## Example Research Flow

```typescript
// STEP 1: Research (REQUIRED)
const bestPractices = await search_with_grounding({
  query: "TypeScript async error handling best practices 2024"
});

const libraryComparison = await search_with_grounding({
  query: "best SQLite libraries for Node.js TypeScript 2024"
});

const securityConsiderations = await search_with_grounding({
  query: "SQL injection prevention TypeScript parameterized queries"
});

// STEP 2: Implement based on research
// ... your implementation here
```

## Search Tool

Use the `search_with_grounding` tool extensively for all research needs.

**Remember**: More research = Better implementation. Never skip this step!
