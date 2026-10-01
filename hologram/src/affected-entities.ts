/**
 * What Jarvis says he is working on: the things a request reads or changes, as the agent that took
 * it reported them. The Jarvis server pushes them to every device over the socket each one holds
 * open during a conversation (`jarvis-server-link.ts`), in an `affectedEntities` message, as soon
 * as a tool in the request reports what it touched.
 *
 * An entity is an opaque id from any of his agents — a Home Assistant light, an email inbox, a
 * calendar, whatever the next agent touches — with a name to show for it when the agent had one.
 * Nothing here reads meaning into the id: it is compared and never parsed, because the agents that
 * report them share no format, and a new one should not need a change on every device.
 *
 * The same shape goes the other way too: the headset tells the server what sir is pointing at as
 * one entity (`ServerLink.point`), held to the same limits before it is sent.
 *
 * The message comes from a server this device does not control, over the network, so it is read
 * strictly: the declared shape only, and values that are usable strings within the limits below.
 * Anything else is dropped rather than guessed at. The worst a wrong entity can do is light up the
 * wrong thing, and the worst a dropped one can do is light up nothing.
 */

/** One thing a request affects. */
export interface AffectedEntity {
  /** Opaque, from whichever agent reported it: compared, never parsed. */
  readonly id: string;
  /** For display only. Whatever shows an entity falls back to its id without one. */
  readonly name?: string;
}

/**
 * The longest id that is taken. Longer than any id an agent hands out, and short enough that a
 * server gone wrong cannot fill a device's storage with one.
 */
export const AFFECTED_ENTITY_ID_MAX_LENGTH = 200;

/** The longest name that is taken: a label on a drawer, not a paragraph. */
export const AFFECTED_ENTITY_NAME_MAX_LENGTH = 120;

/** The most entities one message names. A request that touches more is a survey, not a few things. */
export const AFFECTED_ENTITIES_PER_MESSAGE = 50;

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
 * One entity, `{ id, name? }`, held to the same limits whichever way it is going: without a usable
 * id it is nothing, and without a usable name it has none.
 */
export function affectedEntityOf(listed: unknown): AffectedEntity | undefined {
  if (!isRecord(listed)) {
    return undefined;
  }
  const id = usableText(listed.id, AFFECTED_ENTITY_ID_MAX_LENGTH);
  if (id === undefined) {
    return undefined;
  }
  const name = usableText(listed.name, AFFECTED_ENTITY_NAME_MAX_LENGTH);
  return name === undefined ? { id } : { id, name };
}

/**
 * The entities a message's `entities` array names, in the order it named them: each id once, with
 * the first name any mention of it gave, and no more than {@link AFFECTED_ENTITIES_PER_MESSAGE} of
 * them. Anything unusable — a missing or blank id, one too long, a value that is not text, an
 * `entities` that is not an array — is left out, and a name that is unusable leaves its entity
 * without one. Never throws, whatever it is handed.
 */
export function affectedEntitiesOf(message: unknown): readonly AffectedEntity[] {
  if (!isRecord(message) || !Array.isArray(message.entities)) {
    return [];
  }
  const byId = new Map<string, AffectedEntity>();
  for (const listed of message.entities) {
    const entity = affectedEntityOf(listed);
    if (entity === undefined) {
      continue;
    }
    const known = byId.get(entity.id);
    if (known === undefined) {
      if (byId.size === AFFECTED_ENTITIES_PER_MESSAGE) {
        break;
      }
      byId.set(entity.id, entity);
    } else if (known.name === undefined && entity.name !== undefined) {
      byId.set(entity.id, entity);
    }
  }
  return [...byId.values()];
}
