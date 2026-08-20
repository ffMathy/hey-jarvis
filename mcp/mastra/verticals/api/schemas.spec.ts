import { describe, expect, it } from 'bun:test';
import { shoppingListWorkflow } from '../shopping/workflows.js';
import * as apiVertical from './index.js';
import { addToShoppingListSchema, shoppingListResponseSchema } from './schemas.js';

describe('shoppingListResponseSchema', () => {
  it('accepts a response without an item count', () => {
    const result = shoppingListResponseSchema.safeParse({ success: true, message: 'Added 2 items' });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ success: true, message: 'Added 2 items' });
  });

  it('accepts a response with an item count', () => {
    const result = shoppingListResponseSchema.safeParse({
      success: true,
      message: 'Added 2 items',
      itemsProcessed: 2,
    });

    expect(result.data?.itemsProcessed).toBe(2);
  });

  it('accepts a failure response', () => {
    const result = shoppingListResponseSchema.safeParse({ success: false, message: 'The grocer is closed' });

    expect(result.success).toBe(true);
  });

  it('requires both success and message', () => {
    expect(shoppingListResponseSchema.safeParse({}).success).toBe(false);
    expect(shoppingListResponseSchema.safeParse({ success: true }).success).toBe(false);
    expect(shoppingListResponseSchema.safeParse({ message: 'hello' }).success).toBe(false);
  });

  it('rejects a non-numeric item count', () => {
    const result = shoppingListResponseSchema.safeParse({ success: true, message: 'ok', itemsProcessed: 'two' });

    expect(result.success).toBe(false);
  });

  it('drops keys it does not know about', () => {
    const result = shoppingListResponseSchema.safeParse({ success: true, message: 'ok', runId: 'abc' });

    expect(result.data).toEqual({ success: true, message: 'ok' });
  });
});

describe('addToShoppingListSchema', () => {
  it('describes the same contract the shopping list workflow enforces', () => {
    // The schema is published as the API's request type, but the route itself
    // validates against the workflow's own input schema. If the two drift, the
    // published type stops describing what the endpoint accepts.
    const validBody = { prompt: 'Add milk' };
    const emptyPromptBody = { prompt: '' };

    expect(addToShoppingListSchema.safeParse(validBody).success).toBe(
      shoppingListWorkflow.inputSchema.safeParse(validBody).success,
    );
    expect(addToShoppingListSchema.safeParse(emptyPromptBody).success).toBe(
      shoppingListWorkflow.inputSchema.safeParse(emptyPromptBody).success,
    );
    expect(addToShoppingListSchema.safeParse({}).success).toBe(shoppingListWorkflow.inputSchema.safeParse({}).success);
  });
});

describe('the api vertical barrel', () => {
  it('re-exports the route helpers, schemas and token usage tools', () => {
    expect(typeof apiVertical.createWorkflowApiHandler).toBe('function');
    expect(typeof apiVertical.registerWorkflowApi).toBe('function');
    expect(typeof apiVertical.registerApiRoutes).toBe('function');
    expect(apiVertical.addToShoppingListSchema).toBe(addToShoppingListSchema);
    expect(apiVertical.shoppingListResponseSchema).toBe(shoppingListResponseSchema);
    expect(Object.keys(apiVertical.tokenUsageTools)).toHaveLength(4);
  });
});
