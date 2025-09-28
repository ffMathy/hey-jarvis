import { createWorkflow, createToolStep, createAgentStep, createStep } from '../../utils/workflow-factory';
import { z } from 'zod';
import { getCurrentCartContents } from './tools';

// Schema for shopping list input
const shoppingListInputSchema = z.object({
    prompt: z.string().describe('The user request for adding/removing items from the shopping list'),
});

// Schema for extracted product information
const extractedProductSchema = z.object({
    products: z.array(z.object({
        operationType: z.enum(['set', 'remove']).nullable().describe('The operation type. "set" = set the product quantity in the basket to the given amount, "remove" = remove from list, null = product already exists in given quantity in basket, no reason to modify.'),
        name: z.string().describe('Product name'),
        quantity: z.number().describe('Product quantity'),
        unitType: z.string().describe('Unit type (e.g., "stk", "kg", "l")')
    })).describe('List of extracted products from the request'),
});

// Schema for cart snapshot - simplified to match tool output
const cartSnapshotSchema = z.array(z.object({
    objectID: z.string(),
    name: z.string(),
    quantity: z.number(),
    price: z.number(),
    brand: z.string(),
    totalPrice: z.number(),
    attributes: z.array(z.string()),
}));

// Schema for shopping list operation result
const shoppingListResultSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    itemsProcessed: z.number().optional(),
});

// Tool-as-step: Get current cart contents (before snapshot)
const getInitialCartContents = createToolStep({
    id: 'get-initial-cart-contents',
    description: 'Gets the current cart contents before processing the request',
    tool: getCurrentCartContents,
    inputSchema: shoppingListInputSchema,
    inputTransform: (input) => ({}), // getCurrentCartContents doesn't need input
});

// Combine cart data with original prompt for next step
const combineCartWithPrompt = createStep({
    id: 'combine-cart-with-prompt',
    description: 'Combines cart data with original prompt',
    inputSchema: z.object({
        inputData: shoppingListInputSchema,
        cartBefore: cartSnapshotSchema,
    }),
    outputSchema: z.object({
        prompt: z.string(),
        cartBefore: cartSnapshotSchema,
    }),
    execute: async ({ context }) => {
        return {
            prompt: context.inputData.prompt,
            cartBefore: context.cartBefore,
        };
    },
});

// Agent-as-step: Extract product information using Information Extractor logic 
const extractProductInformation = createAgentStep({
    id: 'extract-product-information',
    description: 'Extracts structured product information from the user request using Information Extractor logic',
    agentName: 'shoppingList', // We'll use the existing shopping list agent with specific instructions
    inputSchema: z.object({
        prompt: z.string(),
        cartBefore: cartSnapshotSchema,
    }),
    outputSchema: z.object({
        prompt: z.string(),
        cartBefore: cartSnapshotSchema,
        extractedProducts: extractedProductSchema,
    }),
    prompt: ({ context }) => `Act as an expert extraction algorithm that deals with shopping lists.

Your job is to convert the user's request into a machine-readable format.

# Instructions
- Be aware that the same product may be mentioned multiple times. Combine them into one product with the combined quantity.
- For fresh herbs and products listed multiple times with different quantities, use just one quantity.
- Get the operationType right: use "set" for new items or quantity changes, "remove" for removal, null if item already exists in correct quantity.

# Existing basket contents
${JSON.stringify(context.cartBefore)}

# User request
${context.prompt}

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
}`,
    structuredOutput: {
        schema: extractedProductSchema
    }
});

// Transform extracted products with context
const combineExtractionWithContext = createStep({
    id: 'combine-extraction-with-context',
    description: 'Combines extraction results with context',
    inputSchema: z.object({
        inputData: z.object({
            prompt: z.string(),
            cartBefore: cartSnapshotSchema,
        }),
        extractedProducts: extractedProductSchema,
    }),
    outputSchema: z.object({
        prompt: z.string(),
        cartBefore: cartSnapshotSchema,
        extractedProducts: extractedProductSchema,
    }),
    execute: async ({ context }) => {
        return {
            prompt: context.inputData.prompt,
            cartBefore: context.inputData.cartBefore,
            extractedProducts: context.extractedProducts,
        };
    },
});

// Agent-as-step: Process each extracted product using Shopping List Mutator Agent
const processExtractedProducts = createAgentStep({
    id: 'process-extracted-products',
    description: 'Processes each extracted product using the Shopping List Mutator Agent',
    agentName: 'shoppingList',
    inputSchema: z.object({
        prompt: z.string(),
        cartBefore: cartSnapshotSchema,
        extractedProducts: extractedProductSchema,
    }),
    outputSchema: z.object({
        prompt: z.string(),
        cartBefore: cartSnapshotSchema,
        extractedProducts: extractedProductSchema,
        mutationResults: z.array(z.string()),
    }),
    prompt: ({ context }) => `Process each of these products that need action (operationType is not null) by adding or removing them from the cart:

${JSON.stringify(context.extractedProducts.products.filter(p => p.operationType !== null))}

For each product:
1. If operationType is "set": Add/update the product in the cart
2. If operationType is "remove": Remove the product from the cart

Use your tools to search for products and modify the cart. Return a summary of actions taken for each product.`,
});

// Tool-as-step: Get updated cart contents (after snapshot)  
const getUpdatedCartContents = createToolStep({
    id: 'get-updated-cart-contents',
    description: 'Gets the updated cart contents after processing all items',
    tool: getCurrentCartContents,
    inputSchema: z.object({
        prompt: z.string(),
        cartBefore: cartSnapshotSchema,
        extractedProducts: extractedProductSchema,
        mutationResults: z.array(z.string()),
    }),
    inputTransform: (input) => ({}), // getCurrentCartContents doesn't need input
});

// Combine updated cart with context
const combineUpdatedCartWithContext = createStep({
    id: 'combine-updated-cart-with-context',
    description: 'Combines updated cart with context',
    inputSchema: z.object({
        inputData: z.object({
            prompt: z.string(),
            cartBefore: cartSnapshotSchema,
            extractedProducts: extractedProductSchema,
            mutationResults: z.array(z.string()),
        }),
        cartAfter: cartSnapshotSchema,
    }),
    outputSchema: z.object({
        prompt: z.string(),
        cartBefore: cartSnapshotSchema,
        cartAfter: cartSnapshotSchema,
        extractedProducts: extractedProductSchema,
        mutationResults: z.array(z.string()),
    }),
    execute: async ({ context }) => {
        return {
            prompt: context.inputData.prompt,
            cartBefore: context.inputData.cartBefore,
            cartAfter: context.cartAfter,
            extractedProducts: context.inputData.extractedProducts,
            mutationResults: context.inputData.mutationResults,
        };
    },
});

// Agent-as-step: Generate summary using Summarization Agent
const generateSummary = createAgentStep({
    id: 'generate-summary',
    description: 'Generates a summary of changes using the Summarization Agent',
    agentName: 'shoppingListSummary',
    inputSchema: z.object({
        prompt: z.string(),
        cartBefore: cartSnapshotSchema,
        cartAfter: cartSnapshotSchema,
        extractedProducts: extractedProductSchema,
        mutationResults: z.array(z.string()),
    }),
    outputSchema: shoppingListResultSchema,
    prompt: ({ context }) => `Summarize the shopping list changes in Danish:

Original request: ${context.prompt}

Extracted products: ${JSON.stringify(context.extractedProducts)}

Basket contents before:
${JSON.stringify(context.cartBefore)}

Basket contents after:
${JSON.stringify(context.cartAfter)}

Mutation results:
${context.mutationResults.join('\n')}

Provide a summary in Danish of what was changed.`,
});

// Main shopping list workflow implementing the 3-agent pattern using agent-as-step and tool-as-step
export const shoppingListWorkflow = createWorkflow({
    id: 'shopping-list-workflow',
    inputSchema: shoppingListInputSchema,
    outputSchema: shoppingListResultSchema,
})
    .then(getInitialCartContents)
    .then(combineCartWithPrompt)
    .then(extractProductInformation)
    .then(combineExtractionWithContext)
    .then(processExtractedProducts)
    .then(getUpdatedCartContents)
    .then(combineUpdatedCartWithContext)
    .then(generateSummary)
    .commit();