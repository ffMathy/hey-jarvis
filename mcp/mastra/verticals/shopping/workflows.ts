import { z } from 'zod';
import { createAgentStep, createStep, createToolStep, createWorkflow } from '../../utils/workflows/workflow-factory.js';
import { getCurrentCartContents, shoppingTools } from './tools.js';

// Schema for shopping list input
const shoppingListInputSchema = z.object({
  prompt: z
    .string()
    .min(1, 'Prompt is required')
    .describe('The user request for adding/removing items from the shopping list'),
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

  tool: getCurrentCartContents,
});

// Step 3: Store cart in state
const storeInitialCart = createStep({
  id: 'store-initial-cart',
  description: 'Stores initial cart in state for summary generation',

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

  agentConfig: {
    id: 'shopping-list-extractor',
    name: 'ShoppingListExtractor',
    instructions: `You are a helpful assistant that processes shopping list requests.

Your task is to convert the user's shopping request into structured data.

Guidelines:
- If the same product appears multiple times, combine them into one entry with the total quantity
- For fresh herbs and products with varying quantities, use a single quantity
- Set operationType correctly: "set" for adding or updating items, "remove" for deletions, null if the item already exists with the correct quantity`,
    description: 'Specialized agent for extracting structured product information from shopping requests',
    tools: undefined,
  },
  inputSchema: z.object({}),
  outputSchema: extractedProductSchema,
  prompt: ({ state }) => {
    return `You are a helpful assistant that processes shopping list requests.

Your task is to convert the user's shopping request into structured data.

# Guidelines
- If the same product appears multiple times, combine them into one entry with the total quantity
- For fresh herbs and products with varying quantities, use a single quantity
- Set operationType correctly: "set" for adding or updating items, "remove" for deletions, null if the item already exists with the correct quantity

# Current basket contents
${JSON.stringify(state.cartBefore)}

# User's shopping request
${state.prompt}

Please respond with valid JSON matching this structure:
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

  agentConfig: {
    id: 'shopping-list-mutator',
    name: 'ShoppingListMutator',
    instructions: `You are a helpful shopping assistant that manages shopping cart items.

Your task is to process product operations by adding or removing items from the cart.

For each product operation:
- "set": Add or update the product quantity in the cart using your available tools
- "remove": Remove the product from the cart

Use the find_product_in_catalog tool to search for products and set_product_basket_quantity to update the cart.

Provide a summary of the actions you took for each product.`,
    description: 'Specialized agent for processing shopping cart mutations',
    tools: shoppingTools,
  },
  inputSchema: extractedProductSchema,
  outputSchema: z.object({
    mutationResults: z.array(z.string()),
  }),
  prompt: ({ inputData }) => {
    const productsToProcess = inputData.products.filter((p) => p.operationType !== null);
    return `Please process each of these products that require action (operationType is not null):

${JSON.stringify(productsToProcess)}

For each product:
1. If operationType is "set": Add or update the product in the shopping cart
2. If operationType is "remove": Remove the product from the cart

Use your available tools to search for products and update the cart. Return a summary of the actions taken for each product.`;
  },
});

// Step 6: Prepare to get updated cart (discard mutation results)
const prepareForCartUpdate = createStep({
  id: 'prepare-for-cart-update',
  description: 'Prepares to get updated cart contents',

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

  tool: getCurrentCartContents,
});

// Step 8: Generate summary
// Uses workflow.state for prompt and cartBefore, context for cartAfter
const generateSummary = createAgentStep({
  id: 'generate-summary',
  description: 'Generates a summary of changes using the Summarization Agent',

  agentConfig: {
    id: 'shopping-list-summary',
    name: 'ShoppingListSummary',
    instructions: `You are a helpful shopping assistant that provides summaries of shopping cart changes.

Your task is to review the user's request along with the before and after states of the shopping basket, then provide a clear summary of what changed.

Format your response in a friendly, conversational way in Danish. Include:
- What items were successfully added
- What items were successfully removed  
- What items couldn't be found or added
- Current total items in basket
- Any relevant notes about product selections (e.g., organic vs regular, size choices)

Keep your summary concise but informative.`,
    description: 'Specialized agent for summarizing shopping list changes and providing user feedback',
    tools: undefined,
  },
  inputSchema: cartSnapshotSchema,
  outputSchema: shoppingListResultSchema,
  prompt: (params) => {
    const currentState = params.state;
    return `Please summarize the shopping list changes in Danish:

User's original request: ${currentState.prompt}

Basket contents before the changes:
${JSON.stringify(currentState.cartBefore)}

Basket contents after the changes:
${JSON.stringify(params.inputData)}

Please provide a friendly summary in Danish of what was changed in the shopping basket.`;
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
