---
paths:
  - "mcp/**"
---

# 🚀 **Step-by-Step: Adding a New Vertical**

> Part of [Jarvis Mastra AI Agents → Vertical Organization Conventions](mcp-vertical-organization-conventions.md). Paths in it are relative to `mcp/` unless they say otherwise.

## **Example: Adding a Calendar Vertical**

1. **Create Directory Structure**:
```bash
mkdir -p mastra/verticals/calendar
```

2. **Create Core Files**:
```typescript
// calendar/agent.ts
import { createAgent } from '../../utils/agent-factory';

export const calendarAgent = createAgent({
  name: 'Calendar',
  instructions: 'You are a calendar management agent...',
  tools: calendarTools,
  // memory and model automatically provided by factory
});

// calendar/tools.ts  
import { createTool } from '../../utils/tool-factory';
import { z } from 'zod';

export const getCalendarEvents = createTool({
  id: 'getCalendarEvents',  // camelCase matching variable name
  // ... tool config
});

export const calendarTools = {
  getCalendarEvents,  // Shorthand export
};

// calendar/workflows.ts
import { createWorkflow, createStep } from '../../utils/workflow-factory';

export const calendarSyncWorkflow = createWorkflow({
  id: 'calendarSyncWorkflow',
  // ... workflow config
});

// calendar/index.ts
export { calendarAgent } from './agent';
export { calendarTools } from './tools';
export { calendarSyncWorkflow } from './workflows';
```

3. **Update Main Exports**:
```typescript
// verticals/index.ts
export * from './weather';
export * from './shopping';  
export * from './cooking';
export * from './calendar'; // Add new vertical
```

4. **Register in Mastra**:
```typescript
// mastra/index.ts
import { calendarAgent, calendarSyncWorkflow } from './verticals';

export const mastra = new Mastra({
  agents: {
    // ... existing agents
    calendar: calendarAgent,
  },
  workflows: {
    // ... existing workflows  
    calendarSyncWorkflow,
  },
});
```
