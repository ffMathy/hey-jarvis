import type { KeyValueStorage } from '../page/settings';

/**
 * Every entity Jarvis has ever said he was working on, and where sir put the ones he placed.
 *
 * An entity is whatever one of the agents behind the conversation touched: a Home Assistant light,
 * an email inbox, a calendar, anything with a name. It reaches the headset through the voice agent's
 * `markAffected` client tool as an opaque `id` and, often, a display `name`. The id is never parsed —
 * it may come from any agent, in any shape — and the name is only ever shown.
 *
 * Kept in `localStorage` under a key of this app's own (the origin is shared with the phone's web
 * build and every other Pages project of the owner), as JSON, version 1:
 *
 *     { version: 1,
 *       entities: { [id]: { id, name?, firstMarkedAt, lastMarkedAt, marks,
 *                           placement?: { anchor, offset: [x, y, z], placedAt } } },
 *       anchors:  { [uuid]: { createdAt } } }
 *
 * A placement is relative to one of a few persistent room anchors (`room-anchors.ts`), because the
 * session's `local-floor` space starts somewhere new in every session. Times are epoch milliseconds,
 * so they mean the same thing in the next session.
 *
 * Every operation is pure — `(registry, …) → registry` — and returns the registry it was given when
 * nothing changed, so a caller can tell a change by identity. Both the id and the name are model
 * output, so they are cleaned again here however carefully the session cleaned them: the registry is
 * what outlives a bad call.
 */

/** Where the registry is kept. */
export const ENTITY_REGISTRY_KEY = 'jarvis.horizon.entities';

/** How many entities are remembered: the least recently marked are forgotten past this, placed ones never. */
export const MAX_KNOWN_ENTITIES = 300;

/** The longest id kept. A longer one is not an id anyone chose, and cutting it would make it another. */
export const MAX_ENTITY_ID_LENGTH = 200;

/** The longest name kept; a longer one is cut, since a name is only ever shown. */
export const MAX_ENTITY_NAME_LENGTH = 120;

/** How many entities one mark takes: a call naming more is not a call about things sir can see. */
export const MAX_ENTITIES_PER_MARK = 50;

/** One entity as a `markAffected` call names it. */
export interface EntityReport {
  id: string;
  name?: string;
}

/** A point in an anchor's own space, in metres: x, y, z. */
export type AnchorOffset = [number, number, number];

/** Where an entity was put: `offset` from the persistent anchor whose handle is `anchor`. */
export interface EntityPlacement {
  anchor: string;
  offset: AnchorOffset;
  placedAt: number;
}

export interface KnownEntity {
  id: string;
  name?: string;
  firstMarkedAt: number;
  lastMarkedAt: number;
  /** How many marks have named it. */
  marks: number;
  placement?: EntityPlacement;
}

/** A persistent anchor this app created, by the handle `requestPersistentHandle` gave it. */
export interface RoomAnchorRecord {
  createdAt: number;
}

export interface EntityRegistry {
  version: 1;
  entities: Readonly<Record<string, KnownEntity>>;
  anchors: Readonly<Record<string, RoomAnchorRecord>>;
}

export const EMPTY_REGISTRY: EntityRegistry = Object.freeze({
  version: 1,
  entities: Object.freeze({}),
  anchors: Object.freeze({}),
});

/** Whether an entity sits in the room, was never put anywhere, or was put on an anchor that is gone. */
export type PlacementState = 'placed' | 'unplaced' | 'lost';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1000;
}

/** `id` trimmed, or undefined when it is not one worth keeping. */
export function cleanEntityId(id: unknown): string | undefined {
  if (typeof id !== 'string') return undefined;
  const trimmed = id.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_ENTITY_ID_LENGTH ? trimmed : undefined;
}

/** `name` trimmed and cut to the longest kept, or undefined when there is nothing to show. */
export function cleanEntityName(name: unknown): string | undefined {
  if (typeof name !== 'string') return undefined;
  const trimmed = name.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length <= MAX_ENTITY_NAME_LENGTH ? trimmed : trimmed.slice(0, MAX_ENTITY_NAME_LENGTH).trimEnd();
}

/**
 * The reports worth recording, at most {@link MAX_ENTITIES_PER_MARK}, one per id: the last name given
 * for an id wins, and a later report with no name does not take away an earlier one's.
 */
export function cleanEntityReports(reports: readonly unknown[]): EntityReport[] {
  const byId = new Map<string, EntityReport>();
  for (const report of reports) {
    if (!isRecord(report)) continue;
    const id = cleanEntityId(report.id);
    if (id === undefined) continue;
    const name = cleanEntityName(report.name) ?? byId.get(id)?.name;
    if (!byId.has(id) && byId.size >= MAX_ENTITIES_PER_MARK) break;
    byId.set(id, name === undefined ? { id } : { id, name });
  }
  return [...byId.values()];
}

/** What to show for an entity: its name, or its id when it has none. */
export function entityLabel(entity: { id: string; name?: string }): string {
  return entity.name ?? entity.id;
}

/**
 * Remembers that `reports` were marked at `now`: new ones are added, known ones counted again and
 * given the newer name when there is one. Then the least recently marked unplaced entities beyond
 * {@link MAX_KNOWN_ENTITIES} are forgotten.
 */
export function recordEntities(registry: EntityRegistry, reports: readonly unknown[], now: number): EntityRegistry {
  const cleaned = cleanEntityReports(reports);
  if (cleaned.length === 0) return registry;
  const entities: Record<string, KnownEntity> = { ...registry.entities };
  for (const report of cleaned) {
    const known = entities[report.id];
    const name = report.name ?? known?.name;
    entities[report.id] = {
      ...known,
      id: report.id,
      ...(name === undefined ? {} : { name }),
      firstMarkedAt: known?.firstMarkedAt ?? now,
      lastMarkedAt: now,
      marks: (known?.marks ?? 0) + 1,
    };
  }
  return pruneEntities({ ...registry, entities });
}

/**
 * Forgets the least recently marked entities beyond `limit`. Placed entities — lost ones too — are
 * never forgotten: sir put them there, and a busy week of other marks should not take them away.
 */
export function pruneEntities(registry: EntityRegistry, limit: number = MAX_KNOWN_ENTITIES): EntityRegistry {
  const all = Object.values(registry.entities);
  if (all.length <= limit) return registry;
  const forgettable = all
    .filter((entity) => entity.placement === undefined)
    .sort((first, second) => first.lastMarkedAt - second.lastMarkedAt);
  const excess = Math.min(forgettable.length, all.length - limit);
  if (excess <= 0) return registry;
  const entities: Record<string, KnownEntity> = { ...registry.entities };
  for (const entity of forgettable.slice(0, excess)) delete entities[entity.id];
  return { ...registry, entities };
}

/** Remembers a persistent anchor this app has just been given a handle for. */
export function rememberAnchor(registry: EntityRegistry, anchor: string, now: number): EntityRegistry {
  if (registry.anchors[anchor] !== undefined || cleanEntityId(anchor) !== anchor) return registry;
  return { ...registry, anchors: { ...registry.anchors, [anchor]: { createdAt: now } } };
}

/**
 * Puts a known entity at `offset` from `anchor`, remembering the anchor too if it was not yet. An
 * entity never marked cannot be placed: the drawer only offers marked ones.
 */
export function placeEntity(
  registry: EntityRegistry,
  id: string,
  anchor: string,
  offset: readonly [number, number, number],
  now: number,
): EntityRegistry {
  const known = registry.entities[id];
  if (known === undefined || !offset.every(isCoordinate)) return registry;
  const withAnchor = rememberAnchor(registry, anchor, now);
  if (withAnchor.anchors[anchor] === undefined) return registry;
  const placement: EntityPlacement = { anchor, offset: [offset[0], offset[1], offset[2]], placedAt: now };
  return { ...withAnchor, entities: { ...withAnchor.entities, [id]: { ...known, placement } } };
}

/** Takes an entity out of the room and back into the drawer. */
export function unplaceEntity(registry: EntityRegistry, id: string): EntityRegistry {
  const known = registry.entities[id];
  if (known?.placement === undefined) return registry;
  const { placement: _removed, ...rest } = known;
  return { ...registry, entities: { ...registry.entities, [id]: rest } };
}

/**
 * Forgets a persistent anchor that is gone for good — the headset no longer knows its handle. The
 * entities placed on it keep their placement, which now reads as `lost`: the drawer asks for them to
 * be placed again rather than quietly putting them back among the never-placed.
 */
export function forgetAnchor(registry: EntityRegistry, anchor: string): EntityRegistry {
  if (registry.anchors[anchor] === undefined) return registry;
  const { [anchor]: _removed, ...anchors } = registry.anchors;
  return { ...registry, anchors };
}

/** Whether `id` is placed, unplaced, or lost with its anchor; undefined for an entity never marked. */
export function placementStateOf(registry: EntityRegistry, id: string): PlacementState | undefined {
  const known = registry.entities[id];
  if (known === undefined) return undefined;
  if (known.placement === undefined) return 'unplaced';
  return registry.anchors[known.placement.anchor] === undefined ? 'lost' : 'placed';
}

/** The entities placed on an anchor the registry still has. */
export function placedEntities(registry: EntityRegistry): KnownEntity[] {
  return Object.values(registry.entities).filter((entity) => placementStateOf(registry, entity.id) === 'placed');
}

/** The anchors no placement uses any more, whose persistent handles can be given back. */
export function unusedAnchors(registry: EntityRegistry): string[] {
  const used = new Set(placedEntities(registry).map((entity) => entity.placement?.anchor));
  return Object.keys(registry.anchors).filter((anchor) => !used.has(anchor));
}

/** One entry in the drawer. */
export interface DrawerEntry {
  id: string;
  label: string;
  state: PlacementState;
}

const DRAWER_GROUP: Record<PlacementState, number> = { lost: 0, unplaced: 0, placed: 1 };

/**
 * The drawer's order: what still needs placing first — never placed, or lost with its anchor — then
 * what is already in the room, each most recently marked first, so what Jarvis just worked on is at
 * hand.
 */
export function drawerEntries(registry: EntityRegistry): DrawerEntry[] {
  return Object.values(registry.entities)
    .map((entity) => ({ entity, state: placementStateOf(registry, entity.id) ?? 'unplaced' }))
    .sort(
      (first, second) =>
        DRAWER_GROUP[first.state] - DRAWER_GROUP[second.state] ||
        second.entity.lastMarkedAt - first.entity.lastMarkedAt ||
        first.entity.id.localeCompare(second.entity.id),
    )
    .map(({ entity, state }) => ({ id: entity.id, label: entityLabel(entity), state }));
}

function parsePlacement(value: unknown): EntityPlacement | undefined {
  if (!isRecord(value)) return undefined;
  const anchor = cleanEntityId(value.anchor);
  const { offset, placedAt } = value;
  if (anchor === undefined || !isTime(placedAt) || !Array.isArray(offset) || offset.length !== 3) return undefined;
  const [x, y, z] = offset;
  if (!isCoordinate(x) || !isCoordinate(y) || !isCoordinate(z)) return undefined;
  return { anchor, offset: [x, y, z], placedAt };
}

function parseEntity(key: string, value: unknown): KnownEntity | undefined {
  if (!isRecord(value)) return undefined;
  const id = cleanEntityId(value.id);
  const { firstMarkedAt, lastMarkedAt, marks } = value;
  if (id === undefined || id !== key || !isTime(firstMarkedAt) || !isTime(lastMarkedAt)) return undefined;
  if (typeof marks !== 'number' || !Number.isInteger(marks) || marks < 1) return undefined;
  const name = cleanEntityName(value.name);
  const placement = parsePlacement(value.placement);
  return {
    id,
    ...(name === undefined ? {} : { name }),
    firstMarkedAt,
    lastMarkedAt,
    marks,
    ...(placement === undefined ? {} : { placement }),
  };
}

/**
 * The registry `stored` holds, read with guards: anything that is not version 1 is an empty
 * registry, and within one, each entity or anchor that does not read is left out on its own, so one
 * bad entry never costs sir every placement he made.
 */
export function parseEntityRegistry(stored: string | null): EntityRegistry {
  if (stored === null) return EMPTY_REGISTRY;
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return EMPTY_REGISTRY;
  }
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.entities) || !isRecord(value.anchors)) {
    return EMPTY_REGISTRY;
  }
  const anchors: Record<string, RoomAnchorRecord> = {};
  for (const [key, record] of Object.entries(value.anchors)) {
    if (cleanEntityId(key) === key && isRecord(record) && isTime(record.createdAt)) {
      anchors[key] = { createdAt: record.createdAt };
    }
  }
  const entities: Record<string, KnownEntity> = {};
  for (const [key, record] of Object.entries(value.entities)) {
    const entity = parseEntity(key, record);
    if (entity !== undefined) entities[key] = entity;
  }
  return pruneEntities({ version: 1, entities, anchors });
}

export function serialiseEntityRegistry(registry: EntityRegistry): string {
  return JSON.stringify(registry);
}

/** How long a change waits before it is written, so a burst of marks is one write. */
export const WRITE_DELAY_MILLISECONDS = 500;

/**
 * Calls `callback` after `milliseconds`, and returns what cancels it; the tests hand the store one
 * they step by hand.
 */
export type ScheduleWrite = (callback: () => void, milliseconds: number) => () => void;

const scheduleInBrowser: ScheduleWrite = (callback, milliseconds) => {
  const handle = setTimeout(callback, milliseconds);
  return () => clearTimeout(handle);
};

export interface EntityStore {
  /** The registry as it is now, written or not. */
  readonly registry: EntityRegistry;
  /** Why the last write failed, or undefined when it did not. */
  readonly writeProblem: string | undefined;
  /** Applies `change`, and writes the result a moment later when it is a change. */
  update(change: (registry: EntityRegistry) => EntityRegistry): void;
  /** Writes now whatever is waiting: when the room closes, or the page is hidden. */
  flush(): void;
}

/**
 * The registry, read once from `storage` and written back a moment after each change.
 *
 * Every read and write is caught: `localStorage` throws when the browser has storage switched off,
 * and a registry that cannot be kept still works for the session.
 */
export function createEntityStore(storage: KeyValueStorage, schedule: ScheduleWrite = scheduleInBrowser): EntityStore {
  let registry: EntityRegistry;
  try {
    registry = parseEntityRegistry(storage.getItem(ENTITY_REGISTRY_KEY));
  } catch {
    registry = EMPTY_REGISTRY;
  }
  let cancelWrite: (() => void) | undefined;
  let writeProblem: string | undefined;

  function write() {
    cancelWrite?.();
    cancelWrite = undefined;
    try {
      storage.setItem(ENTITY_REGISTRY_KEY, serialiseEntityRegistry(registry));
      writeProblem = undefined;
    } catch {
      writeProblem = 'This browser would not keep the placements. Check that it allows this site to store data.';
    }
  }

  return {
    get registry() {
      return registry;
    },
    get writeProblem() {
      return writeProblem;
    },
    update(change) {
      const next = change(registry);
      if (next === registry) return;
      registry = next;
      // The first change since the last write sets the timer; the ones after it ride along.
      cancelWrite ??= schedule(write, WRITE_DELAY_MILLISECONDS);
    },
    flush() {
      if (cancelWrite !== undefined) write();
    },
  };
}
