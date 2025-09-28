import { google } from '@ai-sdk/google';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { getCartContents } from './bilka/client';

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

// Schema for cart snapshot
const cartSnapshotSchema = z.object({
    items: z.array(z.object({
        objectID: z.string(),
        name: z.string(),
        quantity: z.number(),
        price: z.number(),
        brand: z.string(),
    })),
});

// Schema for shopping list operation result
const shoppingListResultSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    itemsProcessed: z.number().optional(),
});

// Step 1: Get current cart contents (before snapshot)
const getInitialCartContents = createStep({
    id: 'get-initial-cart-contents',
    description: 'Gets the current cart contents before processing the request',
    inputSchema: shoppingListInputSchema,
    outputSchema: z.object({
        prompt: z.string(),
        cartBefore: cartSnapshotSchema,
    }),
    execute: async ({ inputData }) => {
        // Get current cart contents using the client function directly
        const cartResponse = await getCartContents();

        // Transform cart response to simplified format
        const cartItems = cartResponse.lines
            .flatMap(x => x.lines)
            .flatMap(x => x.orderlines)
            .filter(x => x.product.units > 0)
            .map(x => ({
                objectID: x.product.objectID.toString(),
                name: x.product.name,
                quantity: x.quantity,
                price: x.product.price,
                brand: `${x.product.brand} ${x.product.subBrand}`.trim(),
            }));

        return {
            prompt: inputData.prompt,
            cartBefore: {
                items: cartItems
            }
        };
    },
});

// Step 2: Extract product information from user request
const extractProductInformation = createStep({
    id: 'extract-product-information',
    description: 'Extracts structured product information from the user request using Information Extractor logic',
    inputSchema: z.object({
        prompt: z.string(),
        cartBefore: cartSnapshotSchema,
    }),
    outputSchema: z.object({
        prompt: z.string(),
        cartBefore: cartSnapshotSchema,
        extractedProducts: extractedProductSchema,
    }),
    execute: async ({ inputData, mastra }) => {
        // Create a temporary Information Extractor agent for this task
        const { Agent } = await import('@mastra/core/agent');

        const infoExtractorAgent = new Agent({
            name: 'InformationExtractor',
            instructions: `You are an expert extraction algorithm that deals with shopping lists.

You may be given a question or instruction, and your job is to convert the details of that question or instruction into a machine-readable format that will be given to a script.

# Quantities
Be aware that the same product may be mentioned multiple times. As long as they mean the same, you need to combine it into one product with the combined quantity.

For some products, you should just always have one quantity no matter how many times it has been requested. These include:
- Fresh herbs
- Products listed multiple times but with different quantities (for instance "3 carrots" and "200 grams of carrots" in the same list)

# operationType
It is important to get the operationType right. Do not use "set" as the operationType if an item (or equivalent item) is already in the shopping list. Instead set it to null, but still have the item in the list.

You must respond with valid JSON matching this exact schema:
{
  "products": [
    {
      "operationType": "set" | "remove" | null,
      "name": "string",
      "quantity": number,
      "unitType": "string"
    }
  ]
}

# Existing basket contents
${JSON.stringify(inputData.cartBefore.items)}`,
            model: google('gemini-flash-latest'),
        });

        // Get structured response from the agent
        const response = await infoExtractorAgent.streamVNext([
            {
                role: 'user',
                content: inputData.prompt,
            },
        ]);

        let result = '';
        for await (const chunk of response.textStream) {
            result += chunk;
        }

        // Parse the JSON response
        let extractedProducts;
        try {
            const parsed = JSON.parse(result);
            extractedProducts = extractedProductSchema.parse(parsed);
        } catch (error) {
            // Fallback: create a simple extraction based on common patterns
            extractedProducts = {
                products: [{
                    operationType: 'set' as const,
                    name: inputData.prompt.replace(/add|remove|get|buy/gi, '').trim(),
                    quantity: 1,
                    unitType: 'stk'
                }]
            };
        }

        return {
            prompt: inputData.prompt,
            cartBefore: inputData.cartBefore,
            extractedProducts,
        };
    },
});

// Step 3: Process each extracted product using Shopping List Mutator Agent
const processExtractedProducts = createStep({
    id: 'process-extracted-products',
    description: 'Processes each extracted product using the Shopping List Mutator Agent',
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
    execute: async ({ inputData, mastra }) => {
        const shoppingAgent = mastra?.getAgent('shoppingList');
        if (!shoppingAgent) {
            throw new Error('Shopping list agent not found');
        }

        const mutationResults: string[] = [];

        // Process each product that needs action (operationType is not null)
        for (const product of inputData.extractedProducts.products) {
            if (product.operationType !== null) {
                const productPrompt = `${product.operationType === 'set' ? 'Add' : 'Remove'} ${product.quantity} ${product.unitType} ${product.name}`;

                try {
                    const response = await shoppingAgent.streamVNext([
                        {
                            role: 'user',
                            content: productPrompt,
                        },
                    ]);

                    let result = '';
                    for await (const chunk of response.textStream) {
                        result += chunk;
                    }
                    mutationResults.push(`${product.name}: ${result}`);
                } catch (error) {
                    mutationResults.push(`${product.name}: Error - ${error}`);
                }
            } else {
                mutationResults.push(`${product.name}: No action needed (already in basket)`);
            }
        }

        return {
            prompt: inputData.prompt,
            cartBefore: inputData.cartBefore,
            extractedProducts: inputData.extractedProducts,
            mutationResults,
        };
    },
});

// Step 4: Get updated cart contents (after snapshot)
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
    execute: async ({ inputData }) => {
        // Get updated cart contents using the client function directly
        const cartResponse = await getCartContents();

        // Transform cart response to simplified format
        const cartItems = cartResponse.lines
            .flatMap(x => x.lines)
            .flatMap(x => x.orderlines)
            .filter(x => x.product.units > 0)
            .map(x => ({
                objectID: x.product.objectID.toString(),
                name: x.product.name,
                quantity: x.quantity,
                price: x.product.price,
                brand: `${x.product.brand} ${x.product.subBrand}`.trim(),
            }));

        return {
            prompt: inputData.prompt,
            cartBefore: inputData.cartBefore,
            cartAfter: {
                items: cartItems
            },
            extractedProducts: inputData.extractedProducts,
            mutationResults: inputData.mutationResults,
        };
    },
});

// Step 5: Generate summary using Summarization Agent
const generateSummary = createStep({
    id: 'generate-summary',
    description: 'Generates a summary of changes using the Summarization Agent',
    inputSchema: z.object({
        prompt: z.string(),
        cartBefore: cartSnapshotSchema,
        cartAfter: cartSnapshotSchema,
        extractedProducts: extractedProductSchema,
        mutationResults: z.array(z.string()),
    }),
    outputSchema: shoppingListResultSchema,
    execute: async ({ inputData, mastra }) => {
        const summaryAgent = mastra?.getAgent('shoppingListSummary');
        if (!summaryAgent) {
            throw new Error('Shopping list summary agent not found');
        }

        const summaryPrompt = `Original request: ${inputData.prompt}

Extracted products: ${JSON.stringify(inputData.extractedProducts)}

Basket contents before:
${JSON.stringify(inputData.cartBefore.items)}

Basket contents after:
${JSON.stringify(inputData.cartAfter.items)}

Mutation results:
${inputData.mutationResults.join('\n')}`;

        const response = await summaryAgent.streamVNext([
            {
                role: 'user',
                content: summaryPrompt,
            },
        ]);

        let summary = '';
        for await (const chunk of response.textStream) {
            summary += chunk;
        }

        return {
            success: true,
            message: summary,
            itemsProcessed: inputData.extractedProducts.products.length,
        };
    },
});

// Main shopping list workflow implementing the 3-agent pattern from n8n
export const shoppingListWorkflow = createWorkflow({
    id: 'shopping-list-workflow',
    inputSchema: shoppingListInputSchema,
    outputSchema: shoppingListResultSchema,
})
    .then(getInitialCartContents)
    .then(extractProductInformation)
    .then(processExtractedProducts)
    .then(getUpdatedCartContents)
    .then(generateSummary)
    .commit();