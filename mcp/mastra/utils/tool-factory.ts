import { RequestContext } from '@mastra/core/request-context';
import type { ToolExecuteContext, ToolExecuteFunction, ToolExecutionContext } from '@mastra/core/tools';
import { isValidationError, createTool as mastraCreateTool, noopObserve } from '@mastra/core/tools';

/**
 * Creates a new Mastra Tool with sensible defaults for the Hey Jarvis system.
 *
 * This is a proxy method to the Mastra createTool function that allows us to:
 * - Apply consistent defaults across all tools
 * - Easily modify default behavior in the future
 * - Maintain a single point of tool configuration
 *
 * @param config - The tool configuration object
 * @returns A new Tool instance with applied defaults
 *
 * @example
 * ```typescript
 * import { createTool } from '../utils/tool-factory';
 * import { z } from 'zod';
 *
 * export const myTool = createTool({
 *   id: 'my-tool',
 *   description: 'A helpful tool that does something',
 *   inputSchema: z.object({
 *     input: z.string(),
 *   }),
 *   outputSchema: z.object({
 *     result: z.string(),
 *   }),
 *   execute: async (inputData) => {
 *     return { result: `Processed: ${inputData.input}` };
 *   },
 * });
 * ```
 */
export const createTool = mastraCreateTool;

/**
 * The Mastra handle a tool is given in its execution context.
 *
 * Deliberately wider than the `Mastra` class: the runtime hands tools a structural view of
 * it, so a helper that a tool passes this along to has to accept that view rather than the
 * class, or the call does not typecheck. Re-exported here so verticals keep taking their
 * Mastra types from the factory.
 */
export type ToolMastra = NonNullable<ToolExecuteContext<ToolExecutionContext>['mastra']>;

/**
 * The subset of a Mastra tool needed to invoke it directly.
 *
 * Declared structurally rather than as `Tool<...>` so that shortcuts, workflow
 * steps and other callers can pass any tool-shaped value without having to
 * thread Mastra's eight tool generics through their own signatures.
 */
interface ExecutableTool<TInput, TOutput> {
  id?: string;
  execute?: ToolExecuteFunction<TInput, TOutput, ToolExecutionContext>;
}

/**
 * Builds a `ToolExecuteContext` for invoking a tool outside of an agent or
 * workflow run.
 *
 * Mastra's runtime always supplies `observe` and `requestContext`, so both are
 * required on the context type. Callers outside the runtime (shortcuts,
 * workflow steps calling a tool by hand) have no such context, so this fills in
 * the no-op observer and an empty request context.
 *
 * @param overrides - Context values the caller does have (e.g. `mastra`)
 */
export function createToolExecutionContext(
  overrides: Partial<ToolExecuteContext<ToolExecutionContext>> = {},
): ToolExecuteContext<ToolExecutionContext> {
  return {
    observe: noopObserve,
    requestContext: new RequestContext(),
    ...overrides,
  };
}

/**
 * Invokes a tool's `execute` directly and returns its output.
 *
 * Since Mastra v1.5x a tool's `execute` may resolve to a `ValidationError` (bad
 * input/output) or to `void` (the tool suspended instead of returning). Neither
 * is useful to a direct caller, so both are turned into thrown errors and the
 * caller gets the tool's declared output type back.
 *
 * @param tool - The tool to invoke
 * @param inputData - Input matching the tool's input schema
 * @param context - Any execution context the caller already has
 * @throws If the tool has no `execute`, fails validation, or returns no result
 *
 * @example
 * ```typescript
 * const { devices } = await executeTool(getAllDevices, {});
 * ```
 */
export async function executeTool<TInput, TOutput>(
  tool: ExecutableTool<TInput, TOutput>,
  inputData: TInput,
  context: Partial<ToolExecuteContext<ToolExecutionContext>> = {},
): Promise<TOutput> {
  const toolId = tool.id ?? 'unknown';

  if (!tool.execute) {
    throw new Error(`Tool ${toolId} has no execute function`);
  }

  const result = await tool.execute(inputData, createToolExecutionContext(context));

  if (isValidationError(result)) {
    throw new Error(`Tool ${toolId} failed validation: ${result.message}`);
  }

  // Only `undefined` means "returned nothing" — a tool whose output schema is
  // nullable may legitimately resolve to null.
  if (result === undefined) {
    throw new Error(`Tool ${toolId} returned no result`);
  }

  return result;
}
