import type { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { shoppingListWorkflow } from '../shopping/workflows.js';
import { addToShoppingListSchema, type ShoppingListResponse } from './schemas.js';

/**
 * Registers all API routes on the provided Express router.
 * These routes are intended to be called from Home Assistant via REST calls.
 *
 * @param router - The Express router to register routes on
 */
export function registerApiRoutes(router: Router) {
  /**
   * POST /api/shopping-list
   * Adds items to the shopping list using natural language.
   *
   * Request body:
   * {
   *   "prompt": "Add 2 liters of milk and 500g of cheese"
   * }
   *
   * Response:
   * {
   *   "success": true,
   *   "message": "Successfully processed shopping list request",
   *   "itemsProcessed": 2
   * }
   */
  router.post('/api/shopping-list', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parseResult = addToShoppingListSchema.safeParse(req.body);

      if (!parseResult.success) {
        const errorMessages = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        res.status(400).json({
          success: false,
          message: `Validation failed: ${errorMessages}`,
        } satisfies ShoppingListResponse);
        return;
      }

      const { prompt } = parseResult.data;

      console.log(`[API] Shopping list request received: ${prompt}`);

      const run = await shoppingListWorkflow.createRun();
      const result = await run.start({
        inputData: { prompt },
      });

      if (result.status !== 'success') {
        const errorMessage =
          'error' in result && result.error instanceof Error
            ? result.error.message
            : `Workflow failed with status ${result.status}`;
        console.error(`[API] Shopping list workflow failed: ${errorMessage}`);
        res.status(500).json({
          success: false,
          message: `Failed to process shopping list: ${errorMessage}`,
        } satisfies ShoppingListResponse);
        return;
      }

      console.log('[API] Shopping list workflow completed successfully');

      const workflowResult = result.result as ShoppingListResponse | undefined;
      res.json({
        success: workflowResult?.success ?? true,
        message: workflowResult?.message ?? 'Shopping list request processed successfully',
        itemsProcessed: workflowResult?.itemsProcessed,
      } satisfies ShoppingListResponse);
    } catch (error) {
      console.error('[API] Unexpected error in shopping list endpoint:', error);
      next(error);
    }
  });
}
