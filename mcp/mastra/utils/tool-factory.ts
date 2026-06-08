import {
  isValidationError,
  createTool as mastraCreateTool,
  noopObserve,
  type ToolExecutionContext,
  type ValidationError,
} from '@mastra/core/tools';

export { isValidationError, type ValidationError };

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
 * Default execution context for invoking a tool's `execute` directly — e.g. from
 * a workflow step or shortcut — outside of Mastra's tool runtime.
 *
 * Mastra's runtime normally injects observability helpers (`observe`) into the
 * tool execution context. When calling a tool manually there is no active tracing
 * context, so we supply the no-op `observe` implementation. `observe` became a
 * required field on `ToolExecutionContext` in recent `@mastra/core` releases, so
 * passing an empty object is no longer sufficient.
 */
export const defaultToolExecutionContext: ToolExecutionContext = { observe: noopObserve };
