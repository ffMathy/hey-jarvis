import { Mastra } from '@mastra/core';
import type { AgentConfig } from '@mastra/core/agent';
import type { StandardSchemaWithJSON } from '@mastra/core/schema';
import type { ToolExecuteFunction, ToolExecutionContext } from '@mastra/core/tools';
import {
  type DefaultEngineType,
  type ExecuteFunctionParams,
  createStep as mastraCreateStep,
  createWorkflow as mastraCreateWorkflow,
  type StepParams,
} from '@mastra/core/workflows';
import type { z } from 'zod';
import { createAgent } from '../agent-factory.js';
import { executeTool } from '../tool-factory.js';

/**
 * One suspended step as {@link createWorkflowStateReader} reports it: the id, the path to
 * resume it by, and the payload it suspended with.
 */
export type { WorkflowSuspendedStep } from '@mastra/core/workflows';
/**
 * Reads a persisted workflow run snapshot without touching its raw shape.
 *
 * Re-exported so callers that recover a suspended run from storage — locating the step to
 * resume and the payload it suspended with — keep importing workflow plumbing from this
 * factory rather than from `@mastra/core` directly.
 */
export { createWorkflowStateReader } from '@mastra/core/workflows';

/**
 * A Workflow with all generic parameters set to their defaults.
 * Used when accepting any workflow instance without caring about specific types.
 */
export type AnyWorkflow = import('@mastra/core/workflows').Workflow<
  DefaultEngineType,
  // biome-ignore lint/suspicious/noExplicitAny: Mastra Workflow type requires `any` in its Step bound
  any[],
  string,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown
>;

/**
 * A WorkflowResult with all generic parameters set to their defaults.
 */
// biome-ignore lint/suspicious/noExplicitAny: Mastra WorkflowResult type requires `any` in its Step bound
export type AnyWorkflowResult = import('@mastra/core/workflows').WorkflowResult<unknown, unknown, unknown, any[]>;

let workflowRuntime: Mastra | undefined;

/**
 * The Mastra instance a workflow falls back to when it is not registered on the
 * application's instance.
 *
 * Suspend and resume persist the run snapshot through the workflow's Mastra
 * instance, so a workflow with no instance cannot be resumed at all. Workflows
 * listed in `mastra/index.ts` are bound to the app instance when it is
 * constructed, which overrides this fallback; the fallback is what keeps
 * suspendable workflows working in the standalone MCP server process and in
 * tests.
 *
 * @example
 * ```typescript
 * export const myWorkflow = createWorkflow({
 *   id: 'myWorkflow',
 *   mastra: getWorkflowRuntime(),
 *   inputSchema: z.object({}),
 *   outputSchema: z.object({}),
 * })
 *   .then(suspendingStep)
 *   .commit();
 * ```
 */
export function getWorkflowRuntime(): Mastra {
  workflowRuntime ??= new Mastra({});
  return workflowRuntime;
}

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
export const createWorkflow = mastraCreateWorkflow;

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
export const createStep = mastraCreateStep;

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
    // biome-ignore lint/suspicious/noExplicitAny: Zod v4 resolves z.output<T> to unknown for unconstrained generics; runtime types are correct
    execute: async (params): Promise<any> => {
      // Create agent lazily during execution to avoid top-level awaits
      // Explicitly set memory to undefined to bypass Mastra v1 beta.10+ bug
      // where memory.getInputProcessors() is called but doesn't exist
      const agent = await createAgent({ ...config.agentConfig, memory: undefined });

      const prompt = (await Promise.resolve(config.prompt(params as Parameters<typeof config.prompt>[0])))
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        .trim();

      const messages = [{ role: 'user' as const, content: prompt }];

      // Use generate() instead of stream() — we need the full result anyway,
      // and generate() exposes both .object and .text on the result so we can
      // fall back to text parsing for models that don't support structured output
      // (e.g. Ollama's Hailo cluster strips the JSON-mode `format` field).
      let structuredResponse: Awaited<ReturnType<typeof agent.generate>>;
      try {
        structuredResponse = await agent.generate(messages, {
          structuredOutput: { schema: config.outputSchema },
          toolChoice: 'none',
        });
      } catch (error: unknown) {
        // Structured output failed — retry with plain text.
        // STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED is expected with smaller/local models
        // (e.g. Ollama's qwen2.5-instruct) that don't reliably honour the JSON schema.
        // Treat it as a warning (graceful degradation); log real errors as errors.
        const isValidationFailure =
          error != null &&
          typeof error === 'object' &&
          'id' in error &&
          (error as { id: unknown }).id === 'STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED';

        if (isValidationFailure) {
          console.warn(
            `Agent step "${config.id}" structured output validation failed; retrying without structured output.`,
          );
        } else {
          console.error(
            `Agent step "${config.id}" structured output failed; retrying without structured output.`,
            error,
          );
        }

        structuredResponse = await agent.generate(messages, { toolChoice: 'none' });
      }

      if (structuredResponse.object !== undefined && structuredResponse.object !== null) {
        return config.outputSchema.parse(structuredResponse.object);
      }

      // Structured output returned undefined — try text fallback
      return extractResultFromText(structuredResponse.text, config.outputSchema, config.id);
    },
  });
}

/**
 * Extracts a structured result from raw text when structured output is unavailable.
 * Tries JSON parsing first, then wraps as `{ result: text }` for simple schemas.
 */
function extractResultFromText<T extends z.ZodTypeAny>(
  text: string | undefined,
  schema: T,
  stepId: string,
): z.infer<T> {
  const trimmed = text?.trim();
  if (!trimmed) {
    throw new Error(`Agent step "${stepId}" produced no output`);
  }

  if (trimmed.startsWith('{')) {
    return schema.parse(JSON.parse(trimmed));
  }

  // Not a JSON object — wrap raw text in the schema.
  // Log so unexpected agent output is visible during debugging.
  console.warn(`Agent step "${stepId}" produced non-JSON output, using plain-text schema.`);
  return schema.parse({ result: trimmed });
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
  TStateSchema extends z.ZodTypeAny | undefined = undefined,
  TToolInput = unknown,
  TToolOutput = unknown,
>(config: {
  id: TStepId;
  description: string;
  tool: {
    id?: string;
    // biome-ignore lint/suspicious/noExplicitAny: Tool schemas can be either Zod or StandardSchema depending on Mastra version
    inputSchema?: z.ZodTypeAny | StandardSchemaWithJSON<any>;
    // biome-ignore lint/suspicious/noExplicitAny: Tool schemas can be either Zod or StandardSchema depending on Mastra version
    outputSchema?: z.ZodTypeAny | StandardSchemaWithJSON<any>;
    execute?: ToolExecuteFunction<TToolInput, TToolOutput, ToolExecutionContext>;
  };
  stateSchema?: TStateSchema;
  inputOverrides?: Partial<TToolInput>;
}) {
  if (!config.tool.inputSchema || !config.tool.outputSchema || !config.tool.execute) {
    throw new Error(`Tool for step ${config.id} must have inputSchema, outputSchema, and execute defined`);
  }

  const inputSchema = config.tool.inputSchema as z.ZodTypeAny;
  const outputSchema = config.tool.outputSchema as z.ZodTypeAny;
  const tool = config.tool;

  return createStep<TStepId, TStateSchema, typeof inputSchema, typeof outputSchema>({
    id: config.id,
    description: config.description,
    inputSchema,
    outputSchema,
    stateSchema: config.stateSchema,
    execute: async (params) =>
      await executeTool(
        tool,
        {
          ...(params.inputData as Record<string, unknown>),
          ...(config.inputOverrides ?? {}),
        } as TToolInput,
        { mastra: params.mastra },
      ),
  });
}
