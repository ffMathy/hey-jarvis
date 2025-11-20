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

// Step 1: Get current cart contents using createToolStep and workflow state
const getInitialCartContents = createToolStep({
  id: 'get-initial-cart-contents',
  description: 'Gets the current cart contents before processing the request',
  tool: getCurrentCartContents,
});

// Transform to store in workflow state
const storeInitialCart = createStep({
  id: 'store-initial-cart',
  description: 'Stores initial cart and prompt in workflow state',
  inputSchema: shoppingListInputSchema,
  outputSchema: z.object({}),
  execute: async ({ context, workflow }) => {
    workflow.setState({
      prompt: context.prompt,
      cartBefore: context, // Cart contents from previous step
    });
    return {};
  },
});

// Step 2: Extract product information using workflow state
const extractProductInformation = createAgentStep({
  id: 'extract-product-information',
  description: 'Extracts structured product information from the user request using Information Extractor logic',
  agentName: 'shoppingList',
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

// Store extracted products in workflow state
const storeExtractedProducts = createStep({
  id: 'store-extracted-products',
  description: 'Stores extracted products in workflow state',
  inputSchema: extractedProductSchema,
  outputSchema: z.object({}),
  execute: async ({ context, workflow }) => {
    workflow.setState({
      ...workflow.state,
      extractedProducts: context,
    });
    return {};
  },
});

// Step 3: Process extracted products using workflow state
const processExtractedProducts = createAgentStep({
  id: 'process-extracted-products',
  description: 'Processes each extracted product using the Shopping List Mutator Agent',
  agentName: 'shoppingList',
  inputSchema: z.object({}),
  outputSchema: z.object({
    mutationResults: z.array(z.string()),
  }),
  prompt: ({ workflow }) => {
    const state = workflow.state;
    return `Process each of these products that need action (operationType is not null) by adding or removing them from the cart:

${JSON.stringify(state.extractedProducts.products.filter((p: any) => p.operationType !== null))}

For each product:
1. If operationType is "set": Add/update the product in the cart
2. If operationType is "remove": Remove the product from the cart

Use your tools to search for products and modify the cart. Return a summary of actions taken for each product.`;
  },
});

// Store mutation results in workflow state
const storeMutationResults = createStep({
  id: 'store-mutation-results',
  description: 'Stores mutation results in workflow state',
  inputSchema: z.object({
    mutationResults: z.array(z.string()),
  }),
  outputSchema: z.object({}),
  execute: async ({ context, workflow }) => {
    workflow.setState({
      ...workflow.state,
      mutationResults: context.mutationResults,
    });
    return {};
  },
});

// Step 4: Get updated cart contents using createToolStep
const getUpdatedCartContents = createToolStep({
  id: 'get-updated-cart-contents',
  description: 'Gets the updated cart contents after processing all items',
  tool: getCurrentCartContents,
});

// Store updated cart in workflow state
const storeUpdatedCart = createStep({
  id: 'store-updated-cart',
  description: 'Stores updated cart contents in workflow state',
  inputSchema: cartSnapshotSchema,
  outputSchema: z.object({}),
  execute: async ({ context, workflow }) => {
    workflow.setState({
      ...workflow.state,
      cartAfter: context,
    });
    return {};
  },
});

// Step 5: Generate summary using workflow state
const generateSummary = createAgentStep({
  id: 'generate-summary',
  description: 'Generates a summary of changes using the Summarization Agent',
  agentName: 'shoppingListSummary',
  inputSchema: z.object({}),
  outputSchema: shoppingListResultSchema,
  prompt: ({ workflow }) => {
    const state = workflow.state;
    return `Summarize the shopping list changes in Danish:

Original request: ${state.prompt}

Extracted products: ${JSON.stringify(state.extractedProducts)}

Basket contents before:
${JSON.stringify(state.cartBefore)}

Basket contents after:
${JSON.stringify(state.cartAfter)}

Mutation results:
${state.mutationResults.join('\n')}

Provide a summary in Danish of what was changed.`;
  },
});

// Main shopping list workflow using workflow state and tool-as-step patterns
export const shoppingListWorkflow = createWorkflow({
  id: 'shopping-list-workflow',
  inputSchema: shoppingListInputSchema,
  outputSchema: shoppingListResultSchema,
})
  .then(getInitialCartContents)
  .then(storeInitialCart)
  .then(extractProductInformation)
  .then(storeExtractedProducts)
  .then(processExtractedProducts)
  .then(storeMutationResults)
  .then(getUpdatedCartContents)
  .then(storeUpdatedCart)
  .then(generateSummary)
  .commit();
