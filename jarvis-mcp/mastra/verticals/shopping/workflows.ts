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

// Step 1: Tool-as-step - Get current cart contents (before snapshot)
const getInitialCartContents = createStep({
    id: 'get-initial-cart-contents',
    description: 'Gets the current cart contents before processing the request',
    inputSchema: shoppingListInputSchema,
    outputSchema: z.object({
        prompt: z.string(),
        cartBefore: cartSnapshotSchema,
    }),
    execute: async ({ context }) => {
        // Use the getCurrentCartContents tool directly 
        const cartContents = await getCurrentCartContents.execute({
            context: {},
            runtimeContext: undefined,
            mastra: undefined,
            suspend: undefined,
            writer: undefined
        });

        return {
            prompt: context.prompt,
            cartBefore: cartContents,
        };
    },
});

// Step 2: Agent-as-step - Extract product information using specialized prompt
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

// Step 3: Transform extraction result to include full context
const combineExtractionWithContext = createStep({
    id: 'combine-extraction-with-context',
    description: 'Combines extraction results with original context',
    inputSchema: z.object({
        prompt: z.string(),
        cartBefore: cartSnapshotSchema,
        products: z.array(z.object({
            operationType: z.enum(['set', 'remove']).nullable(),
            name: z.string(),
            quantity: z.number(),
            unitType: z.string()
        })),
    }),
    outputSchema: z.object({
        prompt: z.string(),
        cartBefore: cartSnapshotSchema,
        extractedProducts: extractedProductSchema,
    }),
    execute: async ({ context }) => {
        return {
            prompt: context.prompt,
            cartBefore: context.cartBefore,
            extractedProducts: {
                products: context.products
            },
        };
    },
});

// Step 4: Agent-as-step - Process extracted products using Shopping List Mutator Agent
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

// Step 5: Transform agent response to include mutation results
const transformMutationResults = createStep({
    id: 'transform-mutation-results',
    description: 'Transform agent response to include mutation results',
    inputSchema: z.object({
        prompt: z.string(),
        cartBefore: cartSnapshotSchema,
        extractedProducts: extractedProductSchema,
        result: z.string(),
    }),
    outputSchema: z.object({
        prompt: z.string(),
        cartBefore: cartSnapshotSchema,
        extractedProducts: extractedProductSchema,
        mutationResults: z.array(z.string()),
    }),
    execute: async ({ context }) => {
        // Split the result by lines or create a single item array
        const mutationResults = context.result.split('\n').filter(line => line.trim().length > 0);
        
        return {
            prompt: context.prompt,
            cartBefore: context.cartBefore,
            extractedProducts: context.extractedProducts,
            mutationResults,
        };
    },
});

// Step 6: Get updated cart contents (after processing)
const getUpdatedCartContents = createStep({
    id: 'get-updated-cart-contents',
    description: 'Gets the updated cart contents after processing all items',
    inputSchema: z.object({
        prompt: z.string(),
        cartBefore: cartSnapshotSchema,
        extractedProducts: extractedProductSchema,
        mutationResults: z.array(z.string()),
    }),
    outputSchema: z.object({
        prompt: z.string(),
        cartBefore: cartSnapshotSchema,
        cartAfter: cartSnapshotSchema,
        extractedProducts: extractedProductSchema,
        mutationResults: z.array(z.string()),
    }),
    execute: async ({ context }) => {
        // Use the getCurrentCartContents tool directly
        const cartContents = await getCurrentCartContents.execute({
            context: {},
            runtimeContext: undefined,
            mastra: undefined,
            suspend: undefined,
            writer: undefined
        });

        return {
            prompt: context.prompt,
            cartBefore: context.cartBefore,
            cartAfter: cartContents,
            extractedProducts: context.extractedProducts,
            mutationResults: context.mutationResults,
        };
    },
});

// Step 7: Agent-as-step - Generate summary using Summarization Agent
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

// Step 8: Transform summary result 
const transformSummaryResult = createStep({
    id: 'transform-summary-result',
    description: 'Transform summary result to final format',
    inputSchema: z.object({
        prompt: z.string(),
        cartBefore: cartSnapshotSchema,
        cartAfter: cartSnapshotSchema,
        extractedProducts: extractedProductSchema,
        mutationResults: z.array(z.string()),
        result: z.string(),
    }),
    outputSchema: shoppingListResultSchema,
    execute: async ({ context }) => {
        return {
            success: true,
            message: context.result,
            itemsProcessed: context.extractedProducts.products.length,
        };
    },
});

// Main shopping list workflow implementing the 3-agent pattern using agent-as-step and tool-as-step
export const shoppingListWorkflow = createWorkflow({
    id: 'shopping-list-workflow',
    inputSchema: shoppingListInputSchema,
    outputSchema: shoppingListResultSchema,
})
    .then(getInitialCartContents)
    .then(extractProductInformation)
    .then(combineExtractionWithContext)
    .then(processExtractedProducts)
    .then(transformMutationResults)
    .then(getUpdatedCartContents)
    .then(generateSummary)
    .then(transformSummaryResult)
    .commit();