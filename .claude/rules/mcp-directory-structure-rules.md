---
paths:
  - "mcp/**"
---

# 🏗️ **Directory Structure Rules**

> Part of [Jarvis Mastra AI Agents → Vertical Organization Conventions](mcp-vertical-organization-conventions.md). Paths in it are relative to `mcp/` unless they say otherwise.

## **1. New Vertical Creation**
When adding a new business vertical (e.g., `calendar`, `security`, `entertainment`):

```bash
# Create the vertical directory structure
mastra/verticals/[vertical-name]/
├── agent.ts          # Single general-purpose agent (if simple)
├── agents.ts         # Multiple agents (if moderate complexity)
├── tools.ts          # All tools for this vertical
├── shortcuts.ts      # Cross-vertical tools (optional - see section 3)
├── workflows.ts      # All workflows for this vertical
└── index.ts          # Export everything from this vertical
```

**Examples:**
- **Simple vertical**: `weather/` (1 agent, 1 workflow)
- **Moderate vertical**: `shopping/` (2 agents, 1 workflow)
- **Complex vertical**: `cooking/` (1 general + 3 specialized agents, 1 workflow)

## **2. Sub-Vertical Creation**
For complex verticals with multiple specialized flows, create sub-verticals:

```bash
# Complex vertical with sub-vertical
mastra/verticals/[vertical-name]/
├── agent.ts                    # General vertical agent
├── tools.ts                    # Shared tools for the vertical
├── shortcuts.ts                # Cross-vertical tools (optional)
├── [sub-vertical-name]/        # Specialized sub-vertical
│   ├── agents.ts              # Specialized agents
│   ├── workflows.ts           # Specialized workflows
│   └── index.ts               # Sub-vertical exports
└── index.ts                   # Main vertical exports
```

**Example**: `cooking/meal-planning/` contains 3 specialized agents for complex meal planning workflows

## **3. Shortcuts (Cross-Vertical Tools)**
Shortcuts are tools that "piggy-back" on other verticals' capabilities. They allow a vertical to leverage tools from other domains while providing a domain-specific interface.

**When to use shortcuts:**
- When a vertical needs data or actions from another vertical's domain
- When you want to provide a simplified, domain-specific interface to cross-vertical functionality
- When a vertical needs to integrate with IoT devices, external services, or other agents

**Directory structure with shortcuts:**
```bash
mastra/verticals/commute/
├── agent.ts          # Commute agent (includes both tools and shortcuts)
├── tools.ts          # Core commute tools (getTravelTime, searchPlaces, etc.)
├── shortcuts.ts      # Cross-vertical shortcuts (e.g., getCarNavigationDestination via IoT)
└── index.ts          # Exports tools, shortcuts, and agent
```

**Example shortcuts:**
- **Commute vertical** → `getCarNavigationDestination`: Queries IoT devices to get the Tesla's current navigation destination via Tessie integration
- **Weather vertical** → `getUserCurrentLocation`: Uses IoT device tracking to find user location for weather queries

**Shortcut implementation pattern:**
Shortcuts must use the `createShortcut` utility which automatically reuses the input and output schemas from the underlying tool:

```typescript
// shortcuts.ts
import { createShortcut } from '../../utils/shortcut-factory.js';
import { someToolFromOtherVertical } from '../other-vertical/tools.js';

export const myShortcut = createShortcut({
  id: 'myShortcut',
  description: 'Domain-specific description of what this shortcut does',
  tool: someToolFromOtherVertical,
  execute: async (input) => {
    // Call the underlying tool (schemas are inherited)
    const result = await someToolFromOtherVertical.execute(input);
    
    // Optionally filter/transform the result while maintaining schema compatibility
    return result;
  },
});

export const myVerticalShortcuts = {
  myShortcut,
};
```

A shortcut also inherits the underlying tool's marks: one onto a slow tool is slow (see
[Slow tasks](mcp-routing-slow-tasks.md#slow-tasks)), and one onto a tool that reports what it touches reports it with the
same reader (see [What a request touches](mcp-routing-affected-entities.md#affected-entities)). A shortcut that reshapes the result
is read as touching nothing.

**Agent integration:**
Shortcuts are merged with regular tools when creating agents:
```typescript
// agent.ts
import { myVerticalShortcuts } from './shortcuts.js';
import { myVerticalTools } from './tools.js';

export async function getMyAgent(): Promise<Agent> {
  return createAgent({
    id: 'my-vertical',
    name: 'MyVertical',
    instructions: '...',
    tools: { ...myVerticalTools, ...myVerticalShortcuts },
  });
}
```

**Export pattern:**
```typescript
// index.ts
export { getMyAgent } from './agent.js';
export { myVerticalTools } from './tools.js';
export { myVerticalShortcuts } from './shortcuts.js';
```
