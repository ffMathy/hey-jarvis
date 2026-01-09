---
name: mastra-vertical-organization
description: Guide for organizing code by business verticals in the Mastra project. Use this when creating new features or reorganizing code structure.
---

# Mastra Vertical Organization

This project uses **vertical organization** where code is grouped by business domain, not technical layer.

## Core Principle

Group related agents, tools, and workflows together by business vertical (weather, shopping, cooking) rather than by type (all agents in one folder, all tools in another).

## Directory Structure Rules

### Simple Vertical

For straightforward features with 1-2 agents:

```
mastra/verticals/[vertical-name]/
├── agent.ts          # Single general-purpose agent
├── tools.ts          # All tools for this vertical
├── workflows.ts      # All workflows
└── index.ts          # Export everything
```

Example: `weather/` (1 agent, 4 tools, 1 workflow)

### Moderate Vertical

For features with 2-3 specialized agents:

```
mastra/verticals/[vertical-name]/
├── agents.ts         # Multiple agents (note plural)
├── tools.ts          # Shared tools
├── workflows.ts      # Workflows
└── index.ts          # Exports
```

Example: `shopping/` (2 agents, multiple tools)

### Complex Vertical with Sub-Verticals

For features with 4+ agents or multiple specialized flows:

```
mastra/verticals/[vertical-name]/
├── agent.ts                    # General vertical agent
├── tools.ts                    # Shared tools
├── [sub-vertical-name]/        # Specialized sub-vertical
│   ├── agents.ts              # Specialized agents
│   ├── workflows.ts           # Specialized workflows
│   └── index.ts               # Sub-vertical exports
└── index.ts                   # Main vertical exports
```

Example: `cooking/meal-planning/` (3 specialized agents)

## Naming Conventions

### Files
- **Single agent**: `agent.ts`
- **Multiple agents**: `agents.ts`
- **Tools**: Always `tools.ts`
- **Workflows**: Always `workflows.ts`
- **Exports**: Always `index.ts`

### Agents
- **General**: `[vertical]Agent` (e.g., `weatherAgent`)
- **Specialized**: `[vertical][Purpose]Agent` (e.g., `mealPlanSelectorAgent`)

### Tools
- **Tool IDs**: camelCase matching variable name (e.g., `getCurrentWeather`)
- **Tool exports**: Use variable name directly as shorthand
- **Collection**: `[vertical]Tools` (e.g., `weatherTools`)

### Workflows
- **Workflow IDs**: camelCase (e.g., `weatherMonitoringWorkflow`)

## Export Pattern

Each vertical's `index.ts`:

```typescript
// [Vertical] vertical exports
export { myAgent } from './agent';
export { myTools } from './tools';
export { myWorkflow } from './workflows';
```

Main `verticals/index.ts`:

```typescript
export * from './weather';
export * from './shopping';
export * from './cooking';
```

## When to Split

**Create sub-verticals when:**
- More than 4 specialized agents in one vertical
- Multiple distinct workflows sharing some tools
- Complex business processes with sub-processes
- Clear logical separation within the vertical

## Tool Organization

1. **Vertical Ownership**: Tools belong to exactly one vertical
2. **No Cross-Vertical**: Don't share tools across verticals
3. **Shared Tools**: If truly shared, create a `shared/` vertical

## Benefits

- **High Cohesion**: Related code stays together
- **Business Alignment**: Matches actual domain
- **Clear Ownership**: Each vertical has focused scope
- **Easy Navigation**: Find all code for a feature in one place
