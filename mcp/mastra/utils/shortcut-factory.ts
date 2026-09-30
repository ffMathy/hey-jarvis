import type { Tool, ToolExecutionContext } from '@mastra/core/tools';
import { createTool as mastraCreateTool } from '@mastra/core/tools';
import { affectedEntityReaderOf, markAsAffectingEntities } from './affected-entities.js';
import { isSlowTask, markAsSlow } from './slow-tasks.js';

/**
 * Configuration for creating a shortcut tool that wraps another tool.
 * Shortcuts automatically reuse the input and output schemas from the underlying tool.
 */
interface CreateShortcutConfig<TInput, TOutput> {
  /** Unique identifier for this shortcut tool */
  id: string;
  /** Description of what this shortcut does in the context of the current vertical */
  description: string;
  /** The underlying tool that this shortcut wraps */
  tool: Tool<TInput, TOutput>;
  /**
   * Transform function to execute the underlying tool and optionally transform the result.
   * Receives the input and returns the output (or a transformed version of it).
   */
  execute: (input: TInput, context: ToolExecutionContext) => Promise<TOutput>;
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
export function createShortcut<TInput, TOutput>(config: CreateShortcutConfig<TInput, TOutput>) {
  // Validate that the tool has the required schemas and execute function
  if (!config.tool.inputSchema || !config.tool.outputSchema) {
    throw new Error(
      `Tool ${config.tool.id || 'unknown'} must have both inputSchema and outputSchema defined for use in shortcuts`,
    );
  }
  if (!config.tool.execute) {
    throw new Error(`Tool ${config.tool.id || 'unknown'} must have an execute function defined for use in shortcuts`);
  }

  const shortcut = mastraCreateTool({
    id: config.id,
    description: config.description,
    inputSchema: config.tool.inputSchema,
    outputSchema: config.tool.outputSchema,
    execute: config.execute,
  });

  if (!config.tool.id) {
    return shortcut;
  }

  // A shortcut hands on what its tool returns, so it touches exactly what the tool touches, and
  // the tool's reader reads its result. One that reshapes the result is read as touching nothing.
  const readAffectedEntities = affectedEntityReaderOf(config.tool.id);
  if (readAffectedEntities) {
    markAsAffectingEntities(shortcut, readAffectedEntities);
  }

  // A shortcut onto a slow tool takes exactly as long as the tool does.
  return isSlowTask(config.tool.id) ? markAsSlow(shortcut) : shortcut;
}
