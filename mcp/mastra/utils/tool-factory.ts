import { createTool as mastraCreateTool } from '@mastra/core/tools';

/**
 * Creates a new Mastra Tool with sensible defaults for the Hey Jarvis system.
 *
 * This is a proxy method to the Mastra createTool function that allows us to:
 * - Apply consistent defaults across all tools
 * - Easily modify default behavior in the future
 * - Maintain a single point of tool configuration
 *
 * IMPORTANT: All tools created with this function MUST include an execute function.
 * The Mastra Tool type marks execute as optional, but we require it for all our tools.
 *
 * @param config - The tool configuration object (must include execute function)
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
