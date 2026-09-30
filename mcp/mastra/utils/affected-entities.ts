/**
 * The things a tool reads or changes, which is what sir's headset lights up while Jarvis works.
 *
 * On the headset, sir places things from his home in the room around him -- a light, his inbox,
 * the family calendar -- and the next time Jarvis works on one of them, it glows. For that the
 * voice agent has to be told, while a request is still running, what the request is touching,
 * and the only place that knows is the tool an agent calls. So the knowledge is declared on the
 * tool, the way slowness is (see `slow-tasks.ts`): a tool that touches things is marked with a
 * reader that picks them out of its arguments and its result, and routing reads every tool result
 * a delegation streams through the marks (see `verticals/routing/controller.ts`). Every agent
 * reports what it touches that way, with no step of its own and no import from routing.
 *
 * An entity is an opaque `id` and an optional display `name`. The id is whatever the owning tools
 * accept as that thing's id -- `light.kitchen_ceiling`, a calendar's id, a mail folder -- so an
 * agent later handed one, because sir pointed at it, acts on it without looking it up. Where a
 * tool accepts an alias ("primary", "@default"), its reader reports the canonical id instead, or
 * the headset would record one thing twice and never light the copy he placed.
 *
 * What counts is what a request works on. A survey -- every device in the house, every calendar in
 * the account -- is not marked, because lighting up everything tells sir nothing. Nor is content
 * looked up from the outside world -- a recipe, a place, a forecast -- which is not a thing in his
 * home to place.
 */

import { z } from 'zod';
import { logger } from './logger.js';

/**
 * The longest id reported. Anything longer is not an id a person or a device keeps, and cutting
 * it short would name a different thing, so it is dropped instead.
 */
const MAX_ENTITY_ID_LENGTH = 200;

/** The longest display name reported. A longer one is cut, since it only labels the thing. */
const MAX_ENTITY_NAME_LENGTH = 120;

/** The prefix Mastra gives a workflow when an agent is handed it as a tool. */
const WORKFLOW_TOOL_PREFIX = 'workflow-';

export const affectedEntitySchema = z.object({
  id: z
    .string()
    .describe('The thing’s id, exactly as its own tools take it, such as light.kitchen_ceiling or a calendar id'),
  name: z.string().optional().describe('What the thing is called, for display only, such as "Kitchen ceiling"'),
});

/** One thing a tool read or changed. */
export type AffectedEntity = z.infer<typeof affectedEntitySchema>;

/**
 * Picks the things a call touched out of what the agent passed the tool and what the tool returned.
 *
 * Both arrive as the agent's stream carries them, so a reader parses them with zod rather than
 * trusting their shape. It may throw on a shape it does not recognise: that call is then read as
 * touching nothing.
 */
export type AffectedEntityReader = (toolArguments: unknown, toolResult: unknown) => AffectedEntity[];

const readersByTaskId = new Map<string, AffectedEntityReader>();

/**
 * Marks a tool as one that touches things, and returns it unchanged.
 *
 * @example
 * ```typescript
 * export const getEntityLogbook = markAsAffectingEntities(createTool({ id: 'getEntityLogbook', ... }), readLogbookEntity);
 * ```
 */
export function markAsAffectingEntities<T extends { id: string }>(task: T, read: AffectedEntityReader): T {
  readersByTaskId.set(task.id, read);
  return task;
}

/**
 * How a marked tool picks out what it touched, for a tool built on top of it.
 *
 * A shortcut hands its underlying tool's result straight through, so the same reader reads it --
 * see `shortcut-factory.ts`.
 */
export function affectedEntityReaderOf(taskId: string): AffectedEntityReader | undefined {
  return readersByTaskId.get(taskId);
}

/**
 * The things one tool call touched, as an agent names the tool when calling it.
 *
 * Never throws. A tool that was not marked touched nothing as far as anyone is told, and a reader
 * that cannot read what it was given is logged and read as touching nothing -- a missed glow on
 * the headset is the whole cost, and a request must never fail over one.
 */
export function readAffectedEntities(toolName: string, toolArguments: unknown, toolResult: unknown): AffectedEntity[] {
  const read =
    readersByTaskId.get(toolName) ??
    (toolName.startsWith(WORKFLOW_TOOL_PREFIX)
      ? readersByTaskId.get(toolName.slice(WORKFLOW_TOOL_PREFIX.length))
      : undefined);
  if (!read) {
    return [];
  }

  try {
    return cleanAffectedEntities(read(toolArguments, toolResult));
  } catch (error) {
    logger.warn('Could not read what a tool call touched', {
      toolName,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Entities fit to hand on: ids and names trimmed, empty or overlong ids dropped, overlong names cut,
 * and each id once, with the first name given for it.
 *
 * Exported for the readers that build entities from free text, such as a service call's targets.
 */
export function cleanAffectedEntities(entities: AffectedEntity[]): AffectedEntity[] {
  const cleaned = new Map<string, AffectedEntity>();

  for (const entity of entities) {
    const id = entity.id.trim();
    if (id.length === 0 || id.length > MAX_ENTITY_ID_LENGTH) {
      continue;
    }

    const name = entity.name?.trim().slice(0, MAX_ENTITY_NAME_LENGTH);
    const existing = cleaned.get(id);
    if (existing) {
      existing.name ??= name || undefined;
      continue;
    }

    cleaned.set(id, name ? { id, name } : { id });
  }

  return [...cleaned.values()];
}
