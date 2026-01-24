import type { Tool } from '@mastra/core/tools';
import { createTool as mastraCreateTool } from '@mastra/core/tools';
import type { z } from 'zod';

/**
 * Configuration for creating a shortcut tool that wraps another tool.
 * Shortcuts automatically reuse the input and output schemas from the underlying tool.
 */
interface CreateShortcutConfig<
  TInputSchema extends z.ZodSchema,
  TOutputSchema extends z.ZodSchema,
  TInput extends z.infer<TInputSchema>,
  TOutput extends z.infer<TOutputSchema>,
> {
  /** Unique identifier for this shortcut tool */
  id: string;
  /** Description of what this shortcut does in the context of the current vertical */
  description: string;
  /** The underlying tool that this shortcut wraps */
  tool: Tool<TInputSchema, TOutputSchema>;
  /**
   * Transform function to execute the underlying tool and optionally transform the result.
   * Receives the input and returns the output (or a transformed version of it).
   */
  execute: (input: TInput) => Promise<TOutput>;
}

/**
 * Creates a shortcut tool that wraps another tool from a different vertical.
 *
 * Shortcuts automatically inherit the input and output schemas from the underlying tool,
 * ensuring type safety and schema consistency. This enforces a pattern where shortcuts
 * are thin wrappers that leverage existing tool capabilities.
 *
 * @example
 * ```typescript
 * import { createShortcut } from '../../utils/shortcut-factory.js';
 * import { inferUserLocation } from '../internet-of-things/tools.js';
 *
 * export const getUserCurrentLocation = createShortcut({
 *   id: 'getUserCurrentLocation',
 *   description: 'Get user location for weather purposes',
 *   tool: inferUserLocation,
 *   execute: async (input) => {
 *     // Can call the tool directly and return/transform the result
 *     return await inferUserLocation.execute(input);
 *   },
 * });
 * ```
 */
export function createShortcut<
  TInputSchema extends z.ZodSchema,
  TOutputSchema extends z.ZodSchema,
  TInput extends z.infer<TInputSchema>,
  TOutput extends z.infer<TOutputSchema>,
>(config: CreateShortcutConfig<TInputSchema, TOutputSchema, TInput, TOutput>) {
  // Validate that the tool has the required schemas
  if (!config.tool.inputSchema || !config.tool.outputSchema) {
    throw new Error(
      `Tool ${config.tool.id || 'unknown'} must have both inputSchema and outputSchema defined for use in shortcuts`,
    );
  }

  return mastraCreateTool({
    id: config.id,
    description: config.description,
    inputSchema: config.tool.inputSchema as any,
    outputSchema: config.tool.outputSchema as any,
    execute: config.execute,
  });
}
