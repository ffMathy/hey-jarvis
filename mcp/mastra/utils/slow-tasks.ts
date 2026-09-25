/**
 * Tools and workflows that take minutes rather than seconds.
 *
 * Most of what an agent does answers while the user is still on the line: a calendar lookup, a
 * light switched, a forecast read. A few things do not — a Claude cloud session reading a
 * codebase, or building a page — and a voice conversation held open for those is sir listening to
 * silence. Marking one here is what lets routing notice the moment an agent starts one, and have
 * Jarvis offer to notify him when it is done instead (see `verticals/routing/workflows.ts`).
 *
 * The mark is a property of the tool, not of the agent: the coding agent lists issues in a second
 * and starts an implementation that takes ten minutes, and only the second is worth the offer.
 */

/** The prefix Mastra gives a workflow when an agent is handed it as a tool. */
const WORKFLOW_TOOL_PREFIX = 'workflow-';

const slowTaskIds = new Set<string>();

/**
 * Marks a tool or workflow as slow, and returns it unchanged.
 *
 * @example
 * ```typescript
 * export const runCodingTask = markAsSlow(createTool({ id: 'runCodingTask', ... }));
 * ```
 */
export function markAsSlow<T extends { id: string }>(task: T): T {
  slowTaskIds.add(task.id);
  return task;
}

/**
 * Whether a tool, as an agent names it when calling it, was marked slow.
 *
 * An agent calls a workflow as `workflow-<key>`, so the prefix is looked through as well.
 */
export function isSlowTask(toolName: string): boolean {
  if (slowTaskIds.has(toolName)) {
    return true;
  }

  return toolName.startsWith(WORKFLOW_TOOL_PREFIX) && slowTaskIds.has(toolName.slice(WORKFLOW_TOOL_PREFIX.length));
}
