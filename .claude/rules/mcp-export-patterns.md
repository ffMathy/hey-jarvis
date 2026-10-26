---
paths:
  - "mcp/**"
---

# 📦 **Export Patterns**

> Part of [Jarvis Mastra AI Agents → Vertical Organization Conventions](mcp-vertical-organization-conventions.md). Paths in it are relative to `mcp/` unless they say otherwise.

## **Vertical Index Exports**
Each vertical's `index.ts` must follow this pattern:

```typescript
// [Vertical] vertical exports
export { [agent/agents] } from './agent'; // or './agents'
export { [vertical]Tools } from './tools';
export { [workflows] } from './workflows';
export * from './[sub-vertical]'; // if sub-verticals exist
```

## **Main Verticals Index**
The main `verticals/index.ts` should export everything:

```typescript
// Main verticals exports
export * from './weather';
export * from './shopping';
export * from './cooking';
export * from './[new-vertical]'; // Add new verticals here
```
