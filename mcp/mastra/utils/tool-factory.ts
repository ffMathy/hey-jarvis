import { createTool as mastraCreateTool } from '@mastra/core/tools';
import type { InferZodLikeSchema, ZodLikeSchema } from 'node_modules/@mastra/core/dist/types/zod-compat';
import type { z } from 'zod';

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
