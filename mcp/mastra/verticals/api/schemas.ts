import { z } from 'zod';

/**
 * Schema for adding items to shopping list via API.
 * The prompt contains the natural language request to add items.
 */
export const addToShoppingListSchema = z.object({
  prompt: z
    .string()
    .min(1, 'Prompt is required')
    .describe('The natural language request for adding items to the shopping list'),
});

export type AddToShoppingListInput = z.infer<typeof addToShoppingListSchema>;

/**
 * Schema for the shopping list API response
 */
export const shoppingListResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  itemsProcessed: z.number().optional(),
});

export type ShoppingListResponse = z.infer<typeof shoppingListResponseSchema>;
