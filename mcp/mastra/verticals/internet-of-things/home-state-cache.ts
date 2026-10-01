import { type Connection, type HassEntities, type HassEntity, subscribeEntities } from 'home-assistant-js-websocket';
import { maxBy } from 'lodash-es';
import { logger } from '../../utils/logger.js';
import type {
  ChangedDeviceState,
  DeviceState,
  EntitySummary,
  HomeArea,
  RenderedPerson,
  RenderedZone,
} from './tools.js';

/**
 * A copy of the house, kept current over the websocket the event monitor already holds open.
 *
 * Every question about the house used to be a template render over REST -- a list of entity ids
 * first, then the entities themselves in batches, each a round trip plus a Jinja render on Home
 * Assistant's event loop. "Is the kitchen light on?" paid for that every time, and the larger the
 * house, the more batches it took.
 *
 * Here every state is held instead, through `subscribe_entities` (the compressed subscription
 * Home Assistant's own frontend runs on), alongside the entity, device and area registries, which
 * are fetched once and again whenever Home Assistant announces they changed. The lookups in
 * `tools.ts` read a {@link HomeSnapshot} out of it and answer without a request at all.
 *
 * It is only trusted while the socket is up and the copy is complete: before the first states
 * arrive, and from a dropped connection until the states after the reconnect, {@link getHomeSnapshot}
 * returns `undefined`, and the lookups fall back to asking Home Assistant over REST, as they did
 * before. That is also what every process without the event monitor -- Studio, the tests -- does.
 */

/** Registry events after which the copy of that registry is fetched again. */
const REGISTRY_EVENT_TYPES = ['entity_registry_updated', 'device_registry_updated', 'area_registry_updated'];

/** How long a failed registry fetch is left before it is tried again. */
const REGISTRY_RETRY_AFTER_MS = 60_000;

/**
 * Registry events usually come in bursts -- an integration reloading announces each of its
 * entities -- so the refetch waits this long for the burst to end.
 */
const REGISTRY_REFRESH_DEBOUNCE_MS = 1_000;

/** What the entity registry says about one entity. Entities without an entry are not in it. */
export interface CachedEntityEntry {
  deviceId: string | null;
  areaId: string | null;
  labels: string[];
}

/** What the device registry says about one device. */
export interface CachedDevice {
  name: string | null;
  areaId: string | null;
  labels: string[];
}

/** The house as last seen: every state, and the registries that place them. */
export interface HomeSnapshot {
  states: HassEntities;
  entities: ReadonlyMap<string, CachedEntityEntry>;
  devices: ReadonlyMap<string, CachedDevice>;
  /** Area names by area id, in the registry's order. */
  areas: ReadonlyMap<string, string>;
}

interface EntityRegistryEntry {
  entity_id: string;
  device_id: string | null;
  area_id: string | null;
  labels?: string[];
}

interface DeviceRegistryEntry {
  id: string;
  name: string | null;
  name_by_user: string | null;
  area_id: string | null;
  labels?: string[];
}

interface AreaRegistryEntry {
  area_id: string;
  name: string;
}

type Registries = Pick<HomeSnapshot, 'entities' | 'devices' | 'areas'>;

async function fetchRegistries(connection: Connection): Promise<Registries> {
  const [entities, devices, areas] = await Promise.all([
    connection.sendMessagePromise<EntityRegistryEntry[]>({ type: 'config/entity_registry/list' }),
    connection.sendMessagePromise<DeviceRegistryEntry[]>({ type: 'config/device_registry/list' }),
    connection.sendMessagePromise<AreaRegistryEntry[]>({ type: 'config/area_registry/list' }),
  ]);

  return {
    entities: new Map(
      entities.map((entry) => [
        entry.entity_id,
        { deviceId: entry.device_id, areaId: entry.area_id, labels: entry.labels ?? [] },
      ]),
    ),
    devices: new Map(
      devices.map((entry) => [
        entry.id,
        { name: entry.name_by_user ?? entry.name, areaId: entry.area_id, labels: entry.labels ?? [] },
      ]),
    ),
    areas: new Map(areas.map((entry) => [entry.area_id, entry.name])),
  };
}

/** The cache the running event monitor keeps, if there is one. */
let activeCache: { snapshot(): HomeSnapshot | undefined } | undefined;

/**
 * The house as the websocket last reported it, or `undefined` when there is no live copy to answer
 * from and the caller should ask Home Assistant itself.
 */
export function getHomeSnapshot(): HomeSnapshot | undefined {
  return activeCache?.snapshot();
}

/** Makes {@link getHomeSnapshot} answer with `snapshot`, or with nothing, for tests. */
export function setHomeSnapshotForTest(snapshot: HomeSnapshot | undefined): void {
  activeCache = snapshot ? { snapshot: () => snapshot } : undefined;
}

/**
 * Starts keeping a copy of the house over `connection`, and serves it from {@link getHomeSnapshot}.
 *
 * Returns at once; the copy fills in the background. Returns the function that stops it.
 */
export function startHomeStateCache(connection: Connection): () => void {
  let states: HassEntities | undefined;
  let registries: Registries | undefined;
  let refreshing: Promise<void> | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const refreshRegistries = (): void => {
    if (refreshing) {
      return;
    }
    refreshing = fetchRegistries(connection)
      .then((fetched) => {
        registries = fetched;
        logger.info('Cached the Home Assistant registries', {
          entities: fetched.entities.size,
          devices: fetched.devices.size,
          areas: fetched.areas.size,
        });
      })
      .catch((error: unknown) => {
        logger.warn('Could not fetch the Home Assistant registries; retrying shortly', {
          error: error instanceof Error ? error.message : String(error),
        });
        scheduleRefresh(REGISTRY_RETRY_AFTER_MS);
      })
      .finally(() => {
        refreshing = undefined;
      });
  };

  const scheduleRefresh = (delayMs: number): void => {
    if (stopped) {
      return;
    }
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshRegistries, delayMs);
  };

  const unsubscribeStates = subscribeEntities(connection, (current) => {
    states = current;
  });

  const registrySubscriptions = REGISTRY_EVENT_TYPES.map((eventType) =>
    connection.subscribeEvents(() => scheduleRefresh(REGISTRY_REFRESH_DEBOUNCE_MS), eventType),
  );

  // The states held across a drop are whatever they were when it happened, so nothing is answered
  // from them until the resubscription after the reconnect has replaced them. The registries may
  // have changed meanwhile too, without an event reaching us.
  const onDisconnected = (): void => {
    states = undefined;
  };
  const onReady = (): void => refreshRegistries();
  connection.addEventListener('disconnected', onDisconnected);
  connection.addEventListener('ready', onReady);

  refreshRegistries();

  const cache = {
    snapshot: (): HomeSnapshot | undefined => (states && registries ? { states, ...registries } : undefined),
  };
  activeCache = cache;

  return () => {
    stopped = true;
    clearTimeout(refreshTimer);
    unsubscribeStates();
    connection.removeEventListener('disconnected', onDisconnected);
    connection.removeEventListener('ready', onReady);
    for (const subscription of registrySubscriptions) {
      void subscription.then((unsubscribe) => unsubscribe()).catch(() => undefined);
    }
    if (activeCache === cache) {
      activeCache = undefined;
    }
  };
}

// --- Reading the snapshot -------------------------------------------------------------------
//
// Each reader answers exactly what the template it stands in for in `tools.ts` renders, so a
// caller cannot tell which of the two answered.

function domainOf(entityId: string): string {
  return entityId.slice(0, entityId.indexOf('.'));
}

/** The entities in a domain, or every one, in Home Assistant's order. */
function statesIn(snapshot: HomeSnapshot, domain?: string): HassEntity[] {
  const all = Object.values(snapshot.states);
  return domain ? all.filter((entity) => domainOf(entity.entity_id) === domain) : all;
}

/** An entity's name as Home Assistant's `State.name` gives it. */
export function entityName(entity: HassEntity): string {
  const friendlyName = entity.attributes.friendly_name;
  if (typeof friendlyName === 'string' && friendlyName.length > 0) {
    return friendlyName;
  }
  return entity.entity_id.slice(entity.entity_id.indexOf('.') + 1).replace(/_/g, ' ');
}

/**
 * The area an entity is in: its own, or else its device's -- as the `area_name` and
 * `area_entities` template functions read it.
 */
function entityAreaId(snapshot: HomeSnapshot, entityId: string): string | null {
  const entry = snapshot.entities.get(entityId);
  if (!entry) {
    return null;
  }
  if (entry.areaId) {
    return entry.areaId;
  }
  return entry.deviceId ? (snapshot.devices.get(entry.deviceId)?.areaId ?? null) : null;
}

function areaName(snapshot: HomeSnapshot, areaId: string | null): string | null {
  return areaId ? (snapshot.areas.get(areaId) ?? null) : null;
}

function deviceName(snapshot: HomeSnapshot, deviceId: string): string {
  return snapshot.devices.get(deviceId)?.name ?? deviceId;
}

/** Every domain the house has an entity in. */
export function domainsInSnapshot(snapshot: HomeSnapshot): string[] {
  return [...new Set(Object.keys(snapshot.states).map(domainOf))];
}

/** The ids of the entities in a domain, or of every one. */
export function entityIdsInSnapshot(snapshot: HomeSnapshot, domain?: string): string[] {
  return statesIn(snapshot, domain).map((entity) => entity.entity_id);
}

/** The areas, as `getHomeAreas` lists them. */
export function areasInSnapshot(snapshot: HomeSnapshot): HomeArea[] {
  return [...snapshot.areas].map(([id, name]) => ({ id, name }));
}

/** The entities in a domain, or every one, as `findEntities` summarises them. */
export function summarizeEntitiesInSnapshot(snapshot: HomeSnapshot, domain?: string): EntitySummary[] {
  return statesIn(snapshot, domain).map((entity) => {
    const unit = entity.attributes.unit_of_measurement;
    return {
      id: entity.entity_id,
      name: entityName(entity),
      area: areaName(snapshot, entityAreaId(snapshot, entity.entity_id)),
      state: entity.state,
      unit: typeof unit === 'string' ? unit : null,
    };
  });
}

/** The longest string an attribute or state is reported with before it is cut. */
const MAX_STRING_LENGTH = 160;

/** The most items a list attribute is reported with. */
const MAX_LIST_LENGTH = 20;

function cutString(value: string): string {
  return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

/**
 * Shrinks one attribute value the way the device template does: long strings are cut, lists are
 * shortened, and anything shaped like a mapping is flattened to a string, so one chatty attribute
 * cannot crowd out the rest of the house.
 */
export function trimAttributeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return cutString(value);
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_LIST_LENGTH).map((item) => {
      if (typeof item === 'string') {
        return cutString(item);
      }
      return isObject(item) && !Array.isArray(item) ? cutString(JSON.stringify(item)) : item;
    });
  }
  return isObject(value) ? cutString(JSON.stringify(value)) : value;
}

function trimAttributes(attributes: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key, trimAttributeValue(value)]));
}

/** The ids of the entities each device has, in the entity registry's order. */
function entityIdsByDevice(snapshot: HomeSnapshot): Map<string, string[]> {
  const byDevice = new Map<string, string[]>();
  for (const [entityId, entry] of snapshot.entities) {
    if (entry.deviceId) {
      const entityIds = byDevice.get(entry.deviceId) ?? [];
      entityIds.push(entityId);
      byDevice.set(entry.deviceId, entityIds);
    }
  }
  return byDevice;
}

/** The devices that have an entity in `domain`, or any entity, in Home Assistant's order. */
function deviceIdsInSnapshot(snapshot: HomeSnapshot, domain?: string): string[] {
  const deviceIds = statesIn(snapshot, domain).map((entity) => snapshot.entities.get(entity.entity_id)?.deviceId);
  return [...new Set(deviceIds)].filter((deviceId): deviceId is string => typeof deviceId === 'string');
}

/** One device with its entities in `domain`, or `undefined` when it has none with a state. */
function describeDevice(
  snapshot: HomeSnapshot,
  deviceId: string,
  entityIds: string[],
  domain?: string,
): DeviceState | undefined {
  const entities = entityIds.flatMap((entityId): DeviceState['entities'] => {
    const entity = snapshot.states[entityId];
    if (!entity || (domain && domainOf(entityId) !== domain)) {
      return [];
    }
    return [
      {
        id: entityId,
        domain: domainOf(entityId),
        area: areaName(snapshot, entityAreaId(snapshot, entityId)),
        labels: snapshot.entities.get(entityId)?.labels ?? [],
        state: cutString(entity.state),
        attributes: trimAttributes(entity.attributes),
        last_changed: entity.last_changed,
      },
    ];
  });
  if (entities.length === 0) {
    return undefined;
  }

  const lastChanged = maxBy(entities, (entity) => Date.parse(entity.last_changed))?.last_changed;
  const device = snapshot.devices.get(deviceId);
  return {
    id: deviceId,
    name: deviceName(snapshot, deviceId),
    labels: device?.labels ?? [],
    area: areaName(snapshot, device?.areaId ?? null),
    last_changed: lastChanged ?? new Date().toISOString(),
    entities,
  };
}

/**
 * Devices with their entities, as `getAllDevices` renders them.
 *
 * @param deviceIds - The devices to describe; every device with an entity in `domain` (or any
 *   entity) when left out
 * @param domain - Only entities in this domain, and only devices that have one
 */
export function describeDevicesInSnapshot(
  snapshot: HomeSnapshot,
  { deviceIds, domain }: { deviceIds?: string[]; domain?: string } = {},
): DeviceState[] {
  const byDevice = entityIdsByDevice(snapshot);
  return (deviceIds ?? deviceIdsInSnapshot(snapshot, domain)).flatMap((deviceId) => {
    const device = describeDevice(snapshot, deviceId, byDevice.get(deviceId) ?? [], domain);
    return device ? [device] : [];
  });
}

/**
 * The entities a service call reaches, each with its name: the ids given, and every entity of
 * `domain` in the areas and devices given -- as `area_entities` and `device_entities` find them.
 */
export function serviceTargetsInSnapshot(
  snapshot: HomeSnapshot,
  domain: string,
  targets: { entityIds: string[]; areaIds: string[]; deviceIds: string[] },
): { id: string; name: string }[] {
  const inDomain = (entityId: string) => domain === 'homeassistant' || domainOf(entityId) === domain;
  const areaIds = new Set(targets.areaIds);
  const deviceIds = new Set(targets.deviceIds);
  const ids = [...targets.entityIds];

  for (const [entityId, entry] of snapshot.entities) {
    const areaId = entityAreaId(snapshot, entityId);
    const inArea = areaId !== null && areaIds.has(areaId);
    const onDevice = entry.deviceId !== null && deviceIds.has(entry.deviceId);
    if ((inArea || onDevice) && inDomain(entityId)) {
      ids.push(entityId);
    }
  }

  return [...new Set(ids)].flatMap((entityId) => {
    const entity = snapshot.states[entityId];
    return entity ? [{ id: entityId, name: entityName(entity) }] : [];
  });
}

/** The entities whose state changed in the last `sinceSeconds`, as `getChangedDevicesSince` renders them. */
export function changedSinceInSnapshot(
  snapshot: HomeSnapshot,
  sinceSeconds: number,
  domain: string | undefined,
  now = Date.now(),
): ChangedDeviceState[] {
  return statesIn(snapshot, domain).flatMap((entity) => {
    const lastChanged = Date.parse(entity.last_changed);
    if ((now - lastChanged) / 1000 > sinceSeconds) {
      return [];
    }
    const deviceId = snapshot.entities.get(entity.entity_id)?.deviceId ?? null;
    return [
      {
        device_id: deviceId ?? '',
        device_name: deviceId ? deviceName(snapshot, deviceId) : '',
        device_label_ids: deviceId ? (snapshot.devices.get(deviceId)?.labels ?? []) : [],
        entity_id: entity.entity_id,
        entity_label_ids: snapshot.entities.get(entity.entity_id)?.labels ?? [],
        state: entity.state,
        last_changed: Math.trunc(lastChanged / 1000),
      },
    ];
  });
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** The people and zones, as the presence template renders them for `inferUserLocation`. */
export function peopleAndZonesInSnapshot(snapshot: HomeSnapshot): {
  persons: RenderedPerson[];
  zones: RenderedZone[];
} {
  return {
    persons: statesIn(snapshot, 'person').map((person) => ({
      entity_id: person.entity_id,
      state: person.state,
      friendly_name: stringOr(person.attributes.friendly_name, person.entity_id),
      latitude: numberOrNull(person.attributes.latitude),
      longitude: numberOrNull(person.attributes.longitude),
      gps_accuracy: numberOrNull(person.attributes.gps_accuracy),
      source: stringOr(person.attributes.source, ''),
      last_changed: person.last_changed,
    })),
    zones: statesIn(snapshot, 'zone').map((zone) => ({
      entity_id: zone.entity_id,
      friendly_name: stringOr(zone.attributes.friendly_name, zone.entity_id),
      latitude: numberOr(zone.attributes.latitude, 0),
      longitude: numberOr(zone.attributes.longitude, 0),
      radius: numberOr(zone.attributes.radius, 100),
    })),
  };
}
