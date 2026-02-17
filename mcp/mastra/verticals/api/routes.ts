import type { NextFunction, Request, Response, Router } from 'express';
import type { ZodError } from 'zod';
import { logger } from '../../utils/logger.js';
import type { AnyWorkflow, AnyWorkflowResult, NamedWorkflow } from '../../utils/workflows/workflow-types.js';
import { shoppingListWorkflow } from '../shopping/workflows.js';

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
 * Formats Zod validation errors into a human-readable string.
 */
function formatValidationErrors(zodError: ZodError<any>): string {
  return zodError.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
}

/**
 * Extracts an error message from a workflow result.
 */
function extractWorkflowError(result: AnyWorkflowResult): string {
  if ('error' in result && result.error instanceof Error) {
    return result.error.message;
  }
  return `Workflow failed with status ${result.status}`;
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
export function createWorkflowApiHandler(workflow: NamedWorkflow) {
  const workflowName = workflow.name ?? workflow.id;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const inputSchema = workflow.inputSchema;

      if (inputSchema) {
        const parseResult = inputSchema.safeParse(req.body);

        if (!parseResult.success) {
          const errorMessage = formatValidationErrors(parseResult.error as ZodError<any>);
          res.status(400).json({
            success: false,
            message: `Validation failed: ${errorMessage}`,
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
        const errorMessage = extractWorkflowError(result);

        logger.error('[API] Workflow failed', {
          workflowName,
          error: errorMessage,
        });
        res.status(500).json({
          success: false,
          message: `Failed to execute ${workflowName}`,
          error: errorMessage,
        } satisfies WorkflowApiResponse);
        return;
      }

      logger.info('[API] Workflow completed successfully', { workflowName });

      res.json({
        success: true,
        message: `${workflowName} completed successfully`,
        data: result.result,
      } satisfies WorkflowApiResponse);
    } catch (error) {
      logger.error('[API] Unexpected error in endpoint', {
        workflowName,
        error,
      });
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
  workflow: NamedWorkflow;
  /** Optional description for logging purposes */
  description?: string;
}

/**
 * Registers a workflow as a POST API endpoint on the provided router.
 *
 * @param router - The Express router to register the route on
 * @param config - Configuration for the workflow API endpoint
 * @returns The registered path for tracking purposes
 *
 * @example
 * ```typescript
 * const path = registerWorkflowApi(router, {
 *   path: '/api/shopping-list',
 *   workflow: shoppingListWorkflow,
 *   description: 'Add items to the shopping list',
 * });
 * ```
 */
export function registerWorkflowApi(router: Router, config: WorkflowApiConfig): string {
  const handler = createWorkflowApiHandler(config.workflow);
  router.post(config.path, handler);
  logger.info('[API] Registered workflow endpoint', {
    method: 'POST',
    path: config.path,
    workflow: config.workflow.name ?? config.workflow.id,
  });
  return config.path;
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
  registeredPaths.push(
    registerWorkflowApi(router, {
      path: '/api/shopping-list',
      workflow: shoppingListWorkflow,
      description: 'Add items to the shopping list using natural language',
    }),
  );

  // Add more workflow APIs here as needed:
  // registeredPaths.push(registerWorkflowApi(router, { path: '/api/weather', workflow: weatherWorkflow }));
  // registeredPaths.push(registerWorkflowApi(router, { path: '/api/meal-plan', workflow: mealPlanWorkflow }));

  return registeredPaths;
}
