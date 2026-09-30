/**
 * What Jarvis says he is working on: the things a request reads or changes, as the agent that took
 * it reported them and the voice agent passes them on through its `markAffected` client tool.
 *
 * An entity is an opaque id from any of his agents — a Home Assistant light, an email inbox, a
 * calendar, whatever the next agent touches — with a name to show for it when the agent had one.
 * Nothing here reads meaning into the id: it is compared and never parsed, because the agents that
 * report them share no format, and a new one should not need a change on every device.
 *
 * Both halves are model output by the time they arrive here — the voice agent copies them out of a
 * routing response into a tool call — so they are read leniently as to shape and strictly as to
 * value. A near miss on the shape is still what the agent meant, and is taken; a value that is not
 * a usable string is dropped. The worst a wrong entity can do is light up the wrong thing, and the
 * worst a dropped one can do is light up nothing.
 */

/** The client tool's name, as the agent's configuration declares it. */
export const MARK_AFFECTED_TOOL = 'markAffected';

/** One thing a request affects. */
export interface AffectedEntity {
  /** Opaque, from whichever agent reported it: compared, never parsed. */
  readonly id: string;
  /** For display only. Whatever shows an entity falls back to its id without one. */
  readonly name?: string;
}

/**
 * The longest id that is taken. Longer than any id an agent hands out, and short enough that a
 * model stuck repeating itself cannot fill a device's storage with one.
 */
export const AFFECTED_ENTITY_ID_MAX_LENGTH = 200;

/** The longest name that is taken: a label on a drawer, not a paragraph. */
export const AFFECTED_ENTITY_NAME_MAX_LENGTH = 120;

/** The most entities one call marks. A request that touches more is a survey, not a few things. */
export const AFFECTED_ENTITIES_PER_CALL = 50;

/**
 * What the tool answers when it has marked something. The agent is told to call it silently, and a
 * bare acknowledgement gives it nothing to talk about.
 */
export const MARKED_RESULT = 'Marked.';

/** What it answers when the call held nothing usable: true, and still nothing worth retrying. */
export const NOTHING_MARKED_RESULT = 'Nothing marked: no entity had a usable id.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Trimmed, and only if something is left that is no longer than `maxLength`. */
function usableText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const text = value.trim();
  return text.length > 0 && text.length <= maxLength ? text : undefined;
}

/**
 * The list the call carries, whatever the model made of the schema's array: the array itself, the
 * same array written out as JSON — which models sometimes do with a nested parameter — or a lone
 * entity where there should have been a list of one. A string that is not a JSON array is not split up, since an
 * opaque id may well contain whatever it would be split on.
 */
function listedEntities(parameters: unknown): readonly unknown[] {
  if (!isRecord(parameters)) {
    return [];
  }
  const { entities } = parameters;
  if (Array.isArray(entities)) {
    return entities;
  }
  if (isRecord(entities)) {
    return [entities];
  }
  if (typeof entities !== 'string') {
    return [];
  }
  try {
    const written: unknown = JSON.parse(entities);
    return Array.isArray(written) ? written : [];
  } catch {
    return [];
  }
}

/**
 * One listed entity: `{ id, name? }` as declared, a bare id, or `entityId` in place of `id` — a slip
 * a model makes readily after a routing response about entities.
 */
function entityOf(listed: unknown): AffectedEntity | undefined {
  if (typeof listed === 'string') {
    const id = usableText(listed, AFFECTED_ENTITY_ID_MAX_LENGTH);
    return id === undefined ? undefined : { id };
  }
  if (!isRecord(listed)) {
    return undefined;
  }
  const id =
    usableText(listed.id, AFFECTED_ENTITY_ID_MAX_LENGTH) ?? usableText(listed.entityId, AFFECTED_ENTITY_ID_MAX_LENGTH);
  if (id === undefined) {
    return undefined;
  }
  const name = usableText(listed.name, AFFECTED_ENTITY_NAME_MAX_LENGTH);
  return name === undefined ? { id } : { id, name };
}

/**
 * The entities a `markAffected` call names, in the order it named them: each id once, with the
 * first name any mention of it gave, and no more than {@link AFFECTED_ENTITIES_PER_CALL} of them.
 * Anything unusable — a missing or blank id, one too long, a value that is not text — is left out,
 * and a name that is unusable leaves its entity without one. Never throws, whatever it is handed.
 */
export function affectedEntitiesOf(parameters: unknown): readonly AffectedEntity[] {
  const byId = new Map<string, AffectedEntity>();
  for (const listed of listedEntities(parameters)) {
    const entity = entityOf(listed);
    if (entity === undefined) {
      continue;
    }
    const known = byId.get(entity.id);
    if (known === undefined) {
      if (byId.size === AFFECTED_ENTITIES_PER_CALL) {
        break;
      }
      byId.set(entity.id, entity);
    } else if (known.name === undefined && entity.name !== undefined) {
      byId.set(entity.id, entity);
    }
  }
  return [...byId.values()];
}
