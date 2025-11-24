import { z } from 'zod';
import { createAgentStep, createStep, createToolStep, createWorkflow } from '../../utils/workflow-factory.js';
import { getCurrentCartContents } from './tools.js';

// Schema for shopping list input
const shoppingListInputSchema = z.object({
  prompt: z.string().describe('The user request for adding/removing items from the shopping list'),
});

// Schema for extracted product information
const extractedProductSchema = z.object({
  products: z
    .array(
      z.object({
        operationType: z
          .enum(['set', 'remove'])
          .nullable()
          .describe(
            'The operation type. "set" = set the product quantity in the basket to the given amount, "remove" = remove from list, null = product already exists in given quantity in basket, no reason to modify.',
          ),
        name: z.string().describe('Product name'),
        quantity: z.number().describe('Product quantity'),
        unitType: z.string().describe('Unit type (e.g., "stk", "kg", "l")'),
      }),
    )
    .describe('List of extracted products from the request'),
});

// Schema for cart snapshot - must match getCurrentCartContents output exactly
const cartSnapshotSchema = z.array(
  z.object({
    objectID: z.string(),
    name: z.string(),
    price: z.number(),
    brand: z.string(),
    units: z.number(),
    unitsOfMeasure: z.string(),
    quantity: z.number(),
    totalPrice: z.number(),
    attributes: z.array(z.string()),
    type: z.string(),
  }),
);

// Schema for shopping list operation result
const shoppingListResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  itemsProcessed: z.number().optional(),
});

// Define workflow state schema
// State only contains values that span multiple steps (>1 step apart)
const workflowStateSchema = z
  .object({
    prompt: z.string(), // Used by extraction (step 2) and summary (step 5) - spans 3 steps
    cartBefore: z.any(), // Used by summary (step 5) - spans 4 steps
  })
  .partial();

// Step 1: Store prompt and prepare for cart tool
const storePromptAndPrepare = createStep({
  id: 'store-prompt-and-prepare',
  description: 'Stores prompt in state and prepares empty input for cart tool',
  stateSchema: workflowStateSchema,
  inputSchema: shoppingListInputSchema,
  outputSchema: z.object({}),
  execute: async (params) => {
    // Store prompt in state for later use
    params.setState({
      prompt: params.inputData.prompt,
    });

    // Return empty object for cart tool
    return {};
  },
});

// Step 2: Get initial cart contents using createToolStep
const getInitialCartContents = createToolStep({
  id: 'get-initial-cart-contents',
  description: 'Gets the current cart contents before processing the request',
  stateSchema: workflowStateSchema,
  tool: getCurrentCartContents,
});

// Step 3: Store cart in state
const storeInitialCart = createStep({
  id: 'store-initial-cart',
  description: 'Stores initial cart in state for summary generation',
  stateSchema: workflowStateSchema,
  inputSchema: cartSnapshotSchema,
  outputSchema: z.object({}),
  execute: async (params) => {
    // Store cart in state
    params.setState({
      cartBefore: params.inputData,
    });

    // Return empty object for extraction agent
    return {};
  },
});

// Step 4: Extract product information
// Uses workflow.state.prompt (spans from input to here)
const extractProductInformation = createAgentStep({
  id: 'extract-product-information',
  description: 'Extracts structured product information from the user request using Information Extractor logic',
  stateSchema: workflowStateSchema,
  agent: 'shoppingList',
  inputSchema: z.object({}),
  outputSchema: extractedProductSchema,
  prompt: ({ workflow }) => {
    const state = workflow.state;
    return `Act as an expert extraction algorithm that deals with shopping lists.

Your job is to convert the user's request into a machine-readable format.

# Instructions
- Be aware that the same product may be mentioned multiple times. Combine them into one product with the combined quantity.
- For fresh herbs and products listed multiple times with different quantities, use just one quantity.
- Get the operationType right: use "set" for new items or quantity changes, "remove" for removal, null if item already exists in correct quantity.

# Existing basket contents
${JSON.stringify(state.cartBefore)}

# User request
${state.prompt}

Respond with valid JSON matching this schema:
{
  "products": [
    {
      "operationType": "set" | "remove" | null,
      "name": "string",
      "quantity": number,
      "unitType": "string"
    }
  ]
}`;
  },
});

// Step 5: Process extracted products
// Products passed through context - no state needed since only used once
const processExtractedProducts = createAgentStep({
  id: 'process-extracted-products',
  description: 'Processes each extracted product using the Shopping List Mutator Agent',
  stateSchema: workflowStateSchema,
  agent: 'shoppingList',
  inputSchema: extractedProductSchema,
  outputSchema: z.object({
    mutationResults: z.array(z.string()),
  }),
  prompt: ({ context }) => {
    return `Process each of these products that need action (operationType is not null) by adding or removing them from the cart:

${JSON.stringify(context.products.filter((p: any) => p.operationType !== null))}

For each product:
1. If operationType is "set": Add/update the product in the cart
2. If operationType is "remove": Remove the product from the cart

Use your tools to search for products and modify the cart. Return a summary of actions taken for each product.`;
  },
});

// Step 6: Prepare to get updated cart (discard mutation results)
const prepareForCartUpdate = createStep({
  id: 'prepare-for-cart-update',
  description: 'Prepares to get updated cart contents',
  stateSchema: workflowStateSchema,
  inputSchema: z.object({
    mutationResults: z.array(z.string()),
  }),
  outputSchema: z.object({}),
  execute: async () => {
    // Just return empty object for the cart tool
    return {};
  },
});

// Step 7: Get updated cart contents using createToolStep
const getUpdatedCartContents = createToolStep({
  id: 'get-updated-cart-contents',
  description: 'Gets the updated cart contents after processing all items',
  stateSchema: workflowStateSchema,
  tool: getCurrentCartContents,
});

// Step 8: Generate summary
// Uses workflow.state for prompt and cartBefore, context for cartAfter
const generateSummary = createAgentStep({
  id: 'generate-summary',
  description: 'Generates a summary of changes using the Summarization Agent',
  stateSchema: workflowStateSchema,
  agent: 'shoppingListSummary',
  inputSchema: cartSnapshotSchema,
  outputSchema: shoppingListResultSchema,
  prompt: (params) => {
    const state = params.workflow.state;
    return `Summarize the shopping list changes in Danish:

Original request: ${state.prompt}

Basket contents before:
${JSON.stringify(state.cartBefore)}

Basket contents after:
${JSON.stringify(params.context)}

Provide a summary in Danish of what was changed.`;
  },
});

// Main shopping list workflow
// State only used for values that span multiple steps (prompt, cartBefore)
// All other values flow through context from step to step
export const shoppingListWorkflow = createWorkflow({
  id: 'shoppingListWorkflow',
  stateSchema: workflowStateSchema,
  inputSchema: shoppingListInputSchema,
  outputSchema: shoppingListResultSchema,
})
  .then(storePromptAndPrepare)
  .then(getInitialCartContents)
  .then(storeInitialCart)
  .then(extractProductInformation)
  .then(processExtractedProducts)
  .then(prepareForCartUpdate)
  .then(getUpdatedCartContents)
  .then(generateSummary)
  .commit();
