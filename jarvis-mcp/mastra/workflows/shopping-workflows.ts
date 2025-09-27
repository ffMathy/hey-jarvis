import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

// Schema for shopping list input
const shoppingListInputSchema = z.object({
  prompt: z.string().describe('The user request for adding/removing items from the shopping list'),
});

// Schema for shopping list operation result
const shoppingListResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  itemsProcessed: z.number().optional(),
});

// Main step that uses the shopping list agent to process the request
const processShoppingListRequest = createStep({
  id: 'process-shopping-list-request',
  description: 'Processes the shopping list request using the shopping list agent',
  inputSchema: shoppingListInputSchema,
  outputSchema: shoppingListResultSchema,
  execute: async ({ inputData, mastra }) => {
    const shoppingAgent = mastra?.getAgent('ShoppingList');
    if (!shoppingAgent) {
      throw new Error('Shopping list agent not found');
    }

    // Use the shopping list agent to process the request
    const response = await shoppingAgent.streamVNext([
      {
        role: 'user',
        content: inputData.prompt,
      },
    ]);

    let result = '';
    for await (const chunk of response.textStream) {
      result += chunk;
    }

    return {
      success: true,
      message: result,
      itemsProcessed: 1,
    };
  },
});

// Main shopping list workflow - simplified to use just the agent
export const shoppingListWorkflow = createWorkflow({
  id: 'shopping-list-workflow',
  inputSchema: shoppingListInputSchema,
  outputSchema: shoppingListResultSchema,
})
  .then(processShoppingListRequest)
  .commit();