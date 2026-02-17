import type { AgentConfig } from '@mastra/core/agent';
import {
  type DefaultEngineType,
  type ExecuteFunctionParams,
  createStep as mastraCreateStep,
  createWorkflow as mastraCreateWorkflow,
  type Step,
  type StepParams,
  type WorkflowConfig,
} from '@mastra/core/workflows';
import type { z } from 'zod';
import { createAgent } from '../agent-factory.js';

/**
 * Creates a new Mastra Workflow with sensible defaults for the Hey Jarvis system.
 *
 * This is a proxy method to the Mastra createWorkflow function that allows us to:
 * - Apply consistent defaults across all workflows
 * - Easily modify default behavior in the future
 * - Maintain a single point of workflow configuration
 * - Support strong-typed workflow state
 *
 * @param config - The workflow configuration object
 * @returns A new Workflow instance with applied defaults
 *
 * @example
 * ```typescript
 * import { createWorkflow, createStep } from '../utils/workflow-factory';
 * import { z } from 'zod';
 *
 * // Define state schema for strong typing
 * const stateSchema = z.object({
 *   result: z.string(),
 *   count: z.number(),
 * });
 *
 * const myStep = createStep<typeof stateSchema>()({
 *   id: 'my-step',
 *   description: 'A helpful step',
 *   inputSchema: z.object({}),
 *   outputSchema: z.object({ result: z.string() }),
 *   execute: async ({ workflow }) => {
 *     // workflow.state is now strongly typed!
 *     const currentCount = workflow.state.count;
 *     workflow.setState({ ...workflow.state, count: currentCount + 1 });
 *     return { result: 'done' };
 *   },
 * });
 *
 * export const myWorkflow = createWorkflow({
 *   id: 'myWorkflow',
 *   stateSchema,
 *   inputSchema: z.object({}),
 *   outputSchema: z.object({ result: z.string() }),
 * }).then(myStep);
 * ```
 */
export function createWorkflow<
  TWorkflowId extends string = string,
  TState = unknown,
  TInput = unknown,
  TOutput = unknown,
  // biome-ignore lint/suspicious/noExplicitAny: Type parameter defaults for generic workflow factory
  TSteps extends Step<string, any, any, any, any, any, DefaultEngineType>[] = Step[],
  TRequestContext extends Record<string, unknown> | unknown = unknown,
>(config: WorkflowConfig<TWorkflowId, TState, TInput, TOutput, TSteps, TRequestContext>) {
  return mastraCreateWorkflow(config);
}

/**
 * Creates a new Mastra Step with sensible defaults for the Hey Jarvis system.
 *
 * This is a proxy method to the Mastra createStep function that allows us to:
 * - Apply consistent defaults across all steps
 * - Easily modify default behavior in the future
 * - Maintain a single point of step configuration
 * - Support strongly-typed workflow state management via workflow parameter
 *
 * @param config - The step configuration
 * @param options - Optional scorers configuration
 * @returns A Mastra workflow step with type-safe state access
 *
 * @example
 * ```typescript
 * // Define state schema for strong typing
 * const stateSchema = z.object({
 *   result: z.string(),
 *   count: z.number(),
 * });
 *
 * // Create step with typed state
 * const myStep = createStep<typeof stateSchema, typeof inputSchema, typeof outputSchema>({
 *   id: 'my-step',
 *   description: 'A helpful step',
 *   inputSchema: z.object({}),
 *   outputSchema: z.object({}),
 *   execute: async ({ context, workflow }) => {
 *     // workflow.state is now strongly typed!
 *     const currentCount = workflow.state.count;
 *     workflow.setState({
 *       ...workflow.state,
 *       count: currentCount + 1,
 *     });
 *     return {};
 *   },
 * });
 *
 * // Create step without state (no generic parameter needed)
 * const simpleStep = createStep({
 *   id: 'simple-step',
 *   description: 'A simple step',
 *   inputSchema: z.object({ data: z.string() }),
 *   outputSchema: z.object({ result: z.string() }),
 *   execute: async ({ context }) => ({ result: context.data }),
 * });
 * ```
 */
export function createStep<
  TStepId extends string = string,
  TState extends z.ZodTypeAny | undefined = undefined,
  TInput extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput extends z.ZodTypeAny = z.ZodTypeAny,
  TResume extends z.ZodTypeAny | undefined = undefined,
  TSuspend extends z.ZodTypeAny | undefined = undefined,
  TRequestContext extends z.ZodTypeAny | undefined = undefined,
>(config: StepParams<TStepId, TState, TInput, TOutput, TResume, TSuspend, TRequestContext>) {
  return mastraCreateStep(config);
}

/**
 * Creates a workflow step that uses an agent as the step execution.
 * This implements the "agent-as-step" pattern where an existing agent
 * becomes a reusable workflow step.
 *
 * The agent is created lazily during step execution to avoid top-level awaits.
 *
 * @param config - The agent step configuration
 * @returns A Mastra workflow step that executes the specified agent
 *
 * @example
 * ```typescript
 * // Define state schema
 * const stateSchema = z.object({
 *   location: z.string(),
 * });
 *
 * const weatherStep = createAgentStep<typeof stateSchema, typeof inputSchema, typeof outputSchema>({
 *   id: 'weather-check',
 *   description: 'Get weather using weather agent',
 *   agentConfig: {
 *     name: 'Weather',
 *     instructions: 'You are a weather assistant...',
 *     tools: weatherTools,
 *   },
 *   inputSchema: z.object({ location: z.string() }),
 *   outputSchema: z.object({ weather: z.string() }),
 *   prompt: ({ context, workflow }) => {
 *     // workflow.state is strongly typed!
 *     return `Get weather for ${workflow.state.location}`;
 *   },
 * });
 * ```
 */
export function createAgentStep<
  TStepId extends string = string,
  TStateSchema extends z.ZodTypeAny | undefined = undefined,
  TInputSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TOutputSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TResumeSchema extends z.ZodTypeAny | undefined = undefined,
  TSuspendSchema extends z.ZodTypeAny | undefined = undefined,
>(
  config: Pick<
    StepParams<TStepId, TStateSchema, TInputSchema, TOutputSchema, TResumeSchema, TSuspendSchema>,
    'id' | 'description' | 'stateSchema' | 'inputSchema' | 'outputSchema' | 'resumeSchema' | 'suspendSchema'
  > & {
    agentConfig: Omit<AgentConfig, 'model' | 'memory' | 'scorers'> & {
      model?: AgentConfig['model'];
      memory?: AgentConfig['memory'];
      scorers?: AgentConfig['scorers'];
    };
    prompt: (
      params: ExecuteFunctionParams<
        TStateSchema extends z.ZodTypeAny ? z.infer<TStateSchema> : unknown,
        z.infer<TInputSchema>,
        z.infer<TOutputSchema>,
        TResumeSchema extends z.ZodTypeAny ? z.infer<TResumeSchema> : unknown,
        TSuspendSchema extends z.ZodTypeAny ? z.infer<TSuspendSchema> : unknown,
        DefaultEngineType
      >,
    ) => string | Promise<string>;
  },
) {
  return createStep<TStepId, TStateSchema, TInputSchema, TOutputSchema, TResumeSchema, TSuspendSchema>({
    id: config.id,
    description: config.description,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    execute: async (params) => {
      // Create agent lazily during execution to avoid top-level awaits
      // Explicitly set memory to undefined to bypass Mastra v1 beta.10+ bug
      // where memory.getInputProcessors() is called but doesn't exist
      const agent = await createAgent({ ...config.agentConfig, memory: undefined });

      const prompt = (await Promise.resolve(config.prompt(params)))
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        .trim();

      const response = await agent.stream(
        [
          {
            role: 'user',
            content: prompt,
          },
        ],
        {
          structuredOutput: {
            schema: config.outputSchema,
          },
          toolChoice: 'none',
        },
      );

      const result = await response.object;
      return config.outputSchema.parse(result);
    },
  });
}

/**
 * Creates a workflow step that uses a tool as the step execution.
 * This implements the "tool-as-step" pattern where an existing tool
 * becomes a reusable workflow step.
 *
 * @param config - The tool step configuration
 * @returns A Mastra workflow step that executes the specified tool
 *
 * @example
 * ```typescript
 * // Define state schema (if needed)
 * const stateSchema = z.object({
 *   cityName: z.string(),
 * });
 *
 * const getCurrentWeatherStep = createToolStep<typeof stateSchema, typeof inputSchema, typeof toolInputSchema, typeof toolOutputSchema>({
 *   id: 'get-current-weather',
 *   description: 'Get current weather for a city',
 *   tool: getCurrentWeatherByCity,
 *   inputSchema: z.object({ location: z.string() }),
 *   inputTransform: ({ location }) => ({ cityName: location }),
 * });
 * ```
 */
export function createToolStep<
  TStepId extends string = string,
  // biome-ignore lint/suspicious/noExplicitAny: Generic constraint for any state schema
  TStateSchema extends z.ZodTypeAny | undefined = undefined,
  TToolInput = any,
  TToolOutput = any,
>(config: {
  id: TStepId;
  description: string;
  tool: {
    // biome-ignore lint/suspicious/noExplicitAny: Zod type requires any for type parameters
    inputSchema?: z.ZodType<TToolInput, any, any>;
    // biome-ignore lint/suspicious/noExplicitAny: Zod type requires any for type parameters
    outputSchema?: z.ZodType<TToolOutput, any, any>;
    // biome-ignore lint/suspicious/noExplicitAny: Context can be any type
    execute?: (inputData: TToolInput, context?: any) => Promise<TToolOutput>;
  };
  stateSchema?: TStateSchema;
  inputOverrides?: Partial<TToolInput>;
}) {
  if (!config.tool.inputSchema || !config.tool.outputSchema || !config.tool.execute) {
    throw new Error(`Tool for step ${config.id} must have inputSchema, outputSchema, and execute defined`);
  }

  const inputSchema = config.tool.inputSchema;
  const outputSchema = config.tool.outputSchema;
  const execute = config.tool.execute;

  return createStep<TStepId, TStateSchema, typeof inputSchema, typeof outputSchema>({
    id: config.id,
    description: config.description,
    inputSchema,
    outputSchema,
    stateSchema: config.stateSchema,
    execute: async (params) => {
      return await execute(
        {
          ...params.inputData,
          ...(config.inputOverrides ?? {}),
        },
        params.mastra,
      );
    },
  });
}
