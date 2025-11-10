import { createStep as mastraCreateStep, createWorkflow as mastraCreateWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { createScorersConfig } from './scorers-config.js';

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
 * @param options - Additional options for step configuration
 * @returns A new Step instance with applied defaults
 */
export function createStep<
    TInputSchema extends z.ZodSchema,
    TOutputSchema extends z.ZodSchema
>(
    config: {
        id: string;
        description: string;
        inputSchema: TInputSchema;
        outputSchema: TOutputSchema;
        execute: (params: {
            context: z.infer<TInputSchema>;
            mastra?: any;
        }) => Promise<z.infer<TOutputSchema>>;
    },
    options: {
        enableScorers?: boolean;
        customScorers?: Record<string, any>;
        samplingRate?: number;
    } = {}
) {
    const { enableScorers = true, customScorers = {}, samplingRate } = options;

    // Add scorers if enabled
    const stepConfig = enableScorers
        ? {
            ...config,
            scorers: createScorersConfig(customScorers, samplingRate),
        }
        : config;

    // For now, this is a direct proxy to the Mastra createStep function
    // Future enhancements could include:
    // - Automatic error handling and retry logic
    // - Step-level logging and observability
    // - Input/output validation
    // - Step timeout handling
    // - Step-level caching

    return mastraCreateStep(stepConfig);
}

/**
 * Creates a workflow step that uses an agent as the step execution.
 * This implements the "agent-as-step" pattern where an existing agent
 * becomes a reusable workflow step.
 * 
 * @param config - Configuration for the agent step
 * @returns A new Step that executes using the specified agent
 * 
 * @example
 * ```typescript
 * const weatherStep = createAgentStep({
 *   id: 'weather-check',
 *   description: 'Get weather using weather agent',
 *   agentName: 'weather',
 *   inputSchema: z.object({ location: z.string() }),
 *   outputSchema: z.object({ weather: z.string() }),
 *   prompt: ({ context }) => `Get weather for ${context.location}`,
 * });
 * ```
 */
export function createAgentStep<
    TInputSchema extends z.ZodSchema,
    TOutputSchema extends z.ZodSchema
>(config: {
    id: string;
    description: string;
    agentName: string;
    inputSchema: TInputSchema;
    outputSchema: TOutputSchema;
    prompt: (params: { context: z.infer<TInputSchema> }) => string;
}) {
    return createStep({
        id: config.id,
        description: config.description,
        inputSchema: config.inputSchema,
        outputSchema: config.outputSchema,
        execute: async ({ context, mastra }) => {
            const agent = mastra?.getAgent(config.agentName);
            if (!agent) {
                throw new Error(`Agent '${config.agentName}' not found`);
            }

            const prompt = config.prompt({ context });

            const response = await agent.streamVNext([
                {
                    role: 'user',
                    content: prompt,
                },
            ], {
                structuredOutput: {
                    schema: config.outputSchema
                }
            });

            return await response.object;
        },
    });
}

/**
 * Creates a workflow step that uses a tool as the step execution.
 * This implements the "tool-as-step" pattern where an existing tool
 * becomes a reusable workflow step.
 * 
 * @param config - Configuration for the tool step
 * @returns A new Step that executes using the specified tool
 * 
 * @example
 * ```typescript
 * const getCurrentWeatherStep = createToolStep({
 *   id: 'get-current-weather',
 *   description: 'Get current weather for a city',
 *   tool: getCurrentWeatherByCity,
 * });
 * ```
 */
export function createToolStep<
    TToolInput extends z.ZodSchema,
    TToolOutput extends z.ZodSchema
>(config: {
    id: string;
    description: string;
    tool: {
        inputSchema: TToolInput;
        outputSchema: TToolOutput;
        execute: (params: {
            context: z.infer<TToolInput>;
            mastra?: any;
        }) => Promise<z.infer<TToolOutput>>;
    };
}) {
    return createStep({
        id: config.id,
        description: config.description,
        inputSchema: config.tool.inputSchema,
        outputSchema: config.tool.outputSchema,
        execute: async ({ context, mastra }) => {
            return await config.tool.execute({
                context,
                mastra,
            });
        },
    });
}