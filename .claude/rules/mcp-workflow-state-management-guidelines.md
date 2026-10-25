---
paths:
  - "mcp/**"
---

# Workflow State Management Guidelines

> Part of [Jarvis Mastra AI Agents → Development Guidelines](mcp-development-guidelines.md). Paths in it are relative to `mcp/` unless they say otherwise.

**CRITICAL**: Workflow state should **only** be used for values that need to travel across **more than one step**.

## 🎯 **The One-Step Rule**
**If a value is only used by the immediately following step, pass it through context instead of storing it in state.**

State management has overhead and adds complexity. Only use state when:
- A value needs to be accessed **2+ steps away** from where it was created
- Multiple steps need to access the same value
- A value needs to persist through loops (e.g., `dowhile`)
- Human-in-the-loop workflows need to maintain context across suspend/resume

## ✅ **CORRECT State Usage**:

**Example 1: Shopping Workflow - Selective State**
```typescript
// State schema - only values that span multiple steps
const workflowStateSchema = z.object({
  prompt: z.string(),      // Used by step 2 and step 5 - spans 3 steps ✅
  cartBefore: z.any(),     // Used by step 5 - spans 4 steps ✅
});

// Step 1: Get cart
const getCart = createToolStep<typeof workflowStateSchema>()({
  tool: getCurrentCartContents,
});

// Step 2: Store prompt and cart in state (both used later)
const storeForLater = createStep<typeof workflowStateSchema>()({
  execute: async ({ context, workflow }) => {
    workflow.setState({
      prompt: context.prompt,      // Will be used by extraction AND summary
      cartBefore: context.cart,    // Will be used by summary
    });
    return {};
  },
});

// Step 3: Extract products - uses state.prompt
const extractProducts = createAgentStep<typeof workflowStateSchema>()({
  prompt: ({ workflow }) => `Process: ${workflow.state.prompt}`,  // ✅ Uses state
});

// Step 4: Process products - uses context.products (immediate next step)
const processProducts = createAgentStep<typeof workflowStateSchema>()({
  inputSchema: extractedProductSchema,  // ✅ Gets from previous step context
  prompt: ({ context }) => `Process: ${JSON.stringify(context.products)}`,
});

// Step 5: Summary - uses state.prompt and state.cartBefore
const generateSummary = createAgentStep<typeof workflowStateSchema>()({
  prompt: ({ context, workflow }) => {
    return `Original: ${workflow.state.prompt}  // ✅ From state (spans 3 steps)
Before: ${workflow.state.cartBefore}           // ✅ From state (spans 4 steps)  
After: ${context}`;                            // ✅ From context (immediate)
  },
});
```

**Example 2: Weather Workflow - No State Needed**
```typescript
// NO state schema - all values flow through context
const weatherCheck = createAgentStep()({
  outputSchema: z.object({ result: z.string() }),
});

const transform = createStep()({
  inputSchema: z.object({ result: z.string() }),  // ✅ From previous step context
  execute: async ({ context }) => {
    return { weather: context.result };  // ✅ Immediate use, no state needed
  },
});

export const workflow = createWorkflow({
  // No stateSchema ✅
})
  .then(weatherCheck)
  .then(transform);  // Data flows through context
```

## ❌ **INCORRECT State Over-Usage**:

```typescript
// ❌ BAD: Storing values that only go one step
const workflowStateSchema = z.object({
  weatherResult: z.string(),    // ❌ Only used by next step - use context!
  recipes: z.any(),             // ❌ Only used by next step - use context!
  mealplan: z.any(),           // ❌ Only used by next step - use context!
});

// ❌ BAD: Unnecessary storage step
const storeWeather = createStep<typeof workflowStateSchema>()({
  execute: async ({ context, workflow }) => {
    workflow.setState({ weatherResult: context.result });  // ❌ Wasteful!
    return {};
  },
});

// Next step immediately uses it
const useWeather = createStep<typeof workflowStateSchema>()({
  execute: async ({ workflow }) => {
    return { data: workflow.state.weatherResult };  // ❌ Should use context!
  },
});

// ✅ CORRECT: Pass through context
const getWeather = createAgentStep()()({
  outputSchema: z.object({ result: z.string() }),
});

const useWeather = createStep()()({
  inputSchema: z.object({ result: z.string() }),  // ✅ Direct context flow
  execute: async ({ context }) => {
    return { data: context.result };  // ✅ No state needed
  },
});
```

## 📊 **State vs Context Decision Tree**

```
Does the value need to be accessed by a step that is...

→ Immediately next? 
  └─ Use CONTEXT ✅ (no state)

→ 2+ steps away?
  └─ Use STATE ✅ (store in state)

→ Used by multiple different steps?
  └─ Use STATE ✅ (store in state)

→ Needs to persist through loops?
  └─ Use STATE ✅ (store in state)

→ Part of suspend/resume workflow?
  └─ Use STATE ✅ (store in state)
```

## 🏗️ **Implementation Pattern**

**When NOT using state (simple linear workflows):**
```typescript
// No generic parameter, no state schema
const myStep = createStep()()({
  id: 'my-step',
  inputSchema: z.object({ data: z.string() }),
  execute: async ({ context }) => {
    // Use context.data directly
  },
});

export const myWorkflow = createWorkflow({
  // No stateSchema
  inputSchema: z.object({}),
  outputSchema: z.object({}),
});
```

**When using state (values span multiple steps):**
```typescript
// Define state schema
const stateSchema = z.object({
  persistedValue: z.string(),  // Will be used multiple steps later
});

// Use generic parameter with state
const myStep = createStep<typeof stateSchema>()({
  id: 'my-step',
  execute: async ({ context, workflow }) => {
    // Store for later use
    workflow.setState({ persistedValue: context.data });
    
    // Access state
    const value = workflow.state.persistedValue;
  },
});

export const myWorkflow = createWorkflow({
  stateSchema: stateSchema,  // ✅ Provide state schema
  inputSchema: z.object({}),
  outputSchema: z.object({}),
});
```

## 💡 **Key Takeaways**
- **Context is for immediate data flow** between adjacent steps
- **State is for long-distance data sharing** across multiple steps
- **Prefer context over state** when possible - it's simpler and more efficient
- **State adds overhead** - use it only when the value truly spans multiple steps
- **Comment why you're using state** - explain which steps will use the value

**When creating new entities, ALWAYS use the Hey Jarvis factory functions instead of direct Mastra constructors.**
