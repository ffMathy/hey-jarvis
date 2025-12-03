import type { Step, Workflow } from '@mastra/core/workflows';
import type { NextFunction, Request, Response, Router } from 'express';
import type { z } from 'zod';
import { shoppingListWorkflow } from '../shopping/workflows.js';

/**
 * Type for any workflow step - satisfies the Workflow's TSteps constraint
 */
type AnyStep = Step<string, z.ZodObject<z.ZodRawShape>, z.ZodType, z.ZodType, z.ZodType, z.ZodType>;

/**
 * Type alias for workflows that can be converted to API endpoints.
 * Uses Pick to extract only the properties needed for API handling.
 */
type WorkflowLike = Pick<
  Workflow<unknown, AnyStep[], string, z.ZodObject<z.ZodRawShape>, z.ZodType, z.ZodType, z.ZodType>,
  'id' | 'description' | 'inputSchema' | 'outputSchema' | 'createRun'
> & {
  name?: string;
};

/**
 * Standard API response structure for workflow endpoints.
 */
interface WorkflowApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

/**
 * Creates an Express request handler that validates input using the workflow's
 * input schema and executes the workflow.
 *
 * @param workflow - The Mastra workflow to expose as an API endpoint
 * @returns Express middleware function that handles the workflow execution
 *
 * @example
 * ```typescript
 * const handler = createWorkflowApiHandler(shoppingListWorkflow);
 * router.post('/api/shopping-list', handler);
 * ```
 */
export function createWorkflowApiHandler(workflow: WorkflowLike) {
  const workflowName = workflow.name ?? workflow.id;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const inputSchema = workflow.inputSchema;

      if (inputSchema) {
        const parseResult = inputSchema.safeParse(req.body);

        if (!parseResult.success) {
          const errorMessages = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
          res.status(400).json({
            success: false,
            message: `Validation failed: ${errorMessages}`,
          } satisfies WorkflowApiResponse);
          return;
        }
      }

      console.log(`[API] ${workflowName} request received`);

      const run = await workflow.createRun();
      const result = await run.start({
        inputData: req.body,
      });

      if (result.status !== 'success') {
        const errorMessage =
          'error' in result && result.error instanceof Error
            ? result.error.message
            : `Workflow failed with status ${result.status}`;
        console.error(`[API] ${workflowName} workflow failed: ${errorMessage}`);
        res.status(500).json({
          success: false,
          message: `Failed to execute ${workflowName}`,
          error: errorMessage,
        } satisfies WorkflowApiResponse);
        return;
      }

      console.log(`[API] ${workflowName} workflow completed successfully`);

      res.json({
        success: true,
        message: `${workflowName} completed successfully`,
        data: result.result,
      } satisfies WorkflowApiResponse);
    } catch (error) {
      console.error(`[API] Unexpected error in ${workflowName} endpoint:`, error);
      next(error);
    }
  };
}

/**
 * Configuration for registering a workflow as an API endpoint.
 */
interface WorkflowApiConfig {
  /** The URL path for the API endpoint (e.g., '/api/shopping-list') */
  path: string;
  /** The workflow to expose at this endpoint */
  workflow: WorkflowLike;
  /** Optional description for logging purposes */
  description?: string;
}

/**
 * Registers a workflow as a POST API endpoint on the provided router.
 *
 * @param router - The Express router to register the route on
 * @param config - Configuration for the workflow API endpoint
 *
 * @example
 * ```typescript
 * registerWorkflowApi(router, {
 *   path: '/api/shopping-list',
 *   workflow: shoppingListWorkflow,
 *   description: 'Add items to the shopping list',
 * });
 * ```
 */
export function registerWorkflowApi(router: Router, config: WorkflowApiConfig) {
  const handler = createWorkflowApiHandler(config.workflow);
  router.post(config.path, handler);
  console.log(
    `[API] Registered workflow endpoint: POST ${config.path} -> ${config.workflow.name ?? config.workflow.id}`,
  );
}

/**
 * Registers all API routes on the provided Express router.
 * These routes are intended to be called from Home Assistant via REST calls.
 *
 * @param router - The Express router to register routes on
 * @returns Array of registered API paths for logging purposes
 */
export function registerApiRoutes(router: Router): string[] {
  const registeredPaths: string[] = [];

  // Shopping List API - triggers shoppingListWorkflow
  registerWorkflowApi(router, {
    path: '/api/shopping-list',
    workflow: shoppingListWorkflow,
    description: 'Add items to the shopping list using natural language',
  });
  registeredPaths.push('/api/shopping-list');

  // Add more workflow APIs here as needed:
  // registerWorkflowApi(router, { path: '/api/weather', workflow: weatherWorkflow });
  // registerWorkflowApi(router, { path: '/api/meal-plan', workflow: mealPlanWorkflow });

  return registeredPaths;
}
