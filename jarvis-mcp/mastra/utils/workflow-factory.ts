import { createStep as mastraCreateStep, createWorkflow as mastraCreateWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

/**
 * Creates a new Mastra Workflow with sensible defaults for the Hey Jarvis system.
 * 
 * This is a proxy method to the Mastra createWorkflow function that allows us to:
 * - Apply consistent defaults across all workflows
 * - Easily modify default behavior in the future
 * - Maintain a single point of workflow configuration
 * 
 * @param config - The workflow configuration object
 * @returns A new Workflow instance with applied defaults
 * 
 * @example
 * ```typescript
 * import { createWorkflow, createStep } from '../utils/workflow-factory';
 * import { z } from 'zod';
 * 
 * const myStep = createStep({
 *   id: 'my-step',
 *   description: 'A helpful step',
 *   inputSchema: z.object({}),
 *   outputSchema: z.object({ result: z.string() }),
 *   execute: async () => ({ result: 'done' }),
 * });
 * 
 * export const myWorkflow = createWorkflow({
 *   id: 'my-workflow',
 *   inputSchema: z.object({}),
 *   outputSchema: z.object({ result: z.string() }),
 * }).then(myStep);
 * ```
 */
export function createWorkflow<
    TInputSchema extends z.ZodSchema,
    TOutputSchema extends z.ZodSchema
>(config: {
    id: string;
    inputSchema: TInputSchema;
    outputSchema: TOutputSchema;
}) {
    // For now, this is a direct proxy to the Mastra createWorkflow function
    // Future enhancements could include:
    // - Automatic error handling and retry logic
    // - Logging and observability
    // - Performance monitoring
    // - Workflow versioning
    // - Automatic step validation

    return mastraCreateWorkflow(config);
}

/**
 * Creates a new Mastra Step with sensible defaults for the Hey Jarvis system.
 * 
 * This is a proxy method to the Mastra createStep function that allows us to:
 * - Apply consistent defaults across all steps
 * - Easily modify default behavior in the future
 * - Maintain a single point of step configuration
 * 
 * @param config - The step configuration object
 * @returns A new Step instance with applied defaults
 */
export function createStep<
    TInputSchema extends z.ZodSchema,
    TOutputSchema extends z.ZodSchema
>(config: {
    id: string;
    description: string;
    inputSchema: TInputSchema;
    outputSchema: TOutputSchema;
    execute: (params: {
        context: z.infer<TInputSchema>;
        mastra?: any;
    }) => Promise<z.infer<TOutputSchema>>;
}) {
    // For now, this is a direct proxy to the Mastra createStep function
    // Future enhancements could include:
    // - Automatic error handling and retry logic
    // - Step-level logging and observability
    // - Input/output validation
    // - Step timeout handling
    // - Step-level caching

    return mastraCreateStep(config);
}