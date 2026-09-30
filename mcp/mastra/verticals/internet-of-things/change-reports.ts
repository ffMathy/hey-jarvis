import { analyzeStateChange, type EntityNoiseBaseline } from '../../storage/entity-noise-baseline.js';
import type { BulkedBusEvent, BulkedStateChange } from './change-bulker.js';

/**
 * Turns released buckets into the reports filed for the State Change Reactor.
 *
 * Kept free of I/O -- the registry and baselines are handed in -- so what gets reported, and
 * what is dropped as sensitive or as noise, is tested without a Home Assistant to talk to.
 */

/**
 * Label used to mark devices/entities that should be excluded from state change monitoring.
 * This matches the old n8n behavior where 'sensitive' labeled items were filtered out.
 */
export const SENSITIVE_LABEL = 'sensitive';

/** The largest event payload, as JSON, that is passed on whole. Anything larger is summarised. */
const MAX_EVENT_DATA_LENGTH = 2_000;

/** The parts of the entity and device registries the monitor needs. */
export interface HomeRegistry {
  entities: Map<string, { deviceId: string | null; labels: string[] }>;
  devices: Map<string, { name: string; labels: string[] }>;
}

/** The device an entity belongs to, and whether either of them is labelled sensitive. */
export function describeEntity(
  registry: HomeRegistry,
  entityId: string,
): { deviceId: string; deviceName: string; sensitive: boolean } {
  const entity = registry.entities.get(entityId);
  const device = entity?.deviceId ? registry.devices.get(entity.deviceId) : undefined;

  return {
    deviceId: entity?.deviceId ?? 'unknown',
    deviceName: device?.name ?? 'Unknown Device',
    sensitive: Boolean(entity?.labels.includes(SENSITIVE_LABEL) || device?.labels.includes(SENSITIVE_LABEL)),
  };
}

/** A state change or event, ready to be handed to `registerStateChange`. */
export interface PlannedReport {
  stateType: 'device_state_change' | 'home_assistant_event';
  stateData: Record<string, unknown>;
}

/**
 * Decides which released state buckets are worth reporting.
 *
 * A bucket is significant when any state its entity passed through stands out from where it
 * started, rather than only the state it ended on: a door that opened and closed again inside
 * one window ends where it began, and is still something that happened.
 */
export function planStateReports(
  changes: BulkedStateChange[],
  registry: HomeRegistry,
  baselines: Map<string, EntityNoiseBaseline>,
  detectedAt: string,
): { reports: PlannedReport[]; filteredAsNoise: number; filteredAsSensitive: number } {
  const reports: PlannedReport[] = [];
  let filteredAsNoise = 0;
  let filteredAsSensitive = 0;

  for (const change of changes) {
    const entity = describeEntity(registry, change.entityId);
    if (entity.sensitive) {
      filteredAsSensitive++;
      continue;
    }

    const baseline = baselines.get(change.entityId);
    const significant = change.observedStates.some(
      (state) => analyzeStateChange(change.entityId, baseline, change.previousState, state).isSignificantChange,
    );

    if (!significant) {
      filteredAsNoise++;
      continue;
    }

    reports.push({
      stateType: 'device_state_change',
      stateData: {
        deviceId: entity.deviceId,
        deviceName: entity.deviceName,
        entityId: change.entityId,
        previousState: change.previousState,
        newState: change.newState,
        lastChanged: change.lastChangedAt,
        detectedAt,
        // Only spelled out when the bucket really bulked something, so a single change reads
        // exactly as it always has.
        ...(change.changeCount > 1 && {
          changeCount: change.changeCount,
          observedStates: change.observedStates,
          firstChanged: change.firstChangedAt,
        }),
      },
    });
  }

  return { reports, filteredAsNoise, filteredAsSensitive };
}

/** An event payload small enough to put in front of the reactor. */
function compactEventData(data: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(data) ?? '';
  if (serialized.length <= MAX_EVENT_DATA_LENGTH) {
    return data;
  }
  return { truncated: true, keys: Object.keys(data) };
}

/** The entity and device an event names, when it names them, and whether either is sensitive. */
function describeEventSource(
  registry: HomeRegistry,
  data: Record<string, unknown>,
): { source: Record<string, string>; sensitive: boolean } {
  const source: Record<string, string> = {};
  let sensitive = false;

  if (typeof data.entity_id === 'string') {
    const entity = describeEntity(registry, data.entity_id);
    source.entityId = data.entity_id;
    source.deviceName = entity.deviceName;
    sensitive = entity.sensitive;
  }

  if (typeof data.device_id === 'string') {
    const device = registry.devices.get(data.device_id);
    source.deviceId = data.device_id;
    if (device) {
      source.deviceName = device.name;
      sensitive ||= device.labels.includes(SENSITIVE_LABEL);
    }
  }

  return { source, sensitive };
}

/** Decides which released event buckets are worth reporting: everything not sensitive. */
export function planEventReports(
  events: BulkedBusEvent[],
  registry: HomeRegistry,
  detectedAt: string,
): { reports: PlannedReport[]; filteredAsSensitive: number } {
  const reports: PlannedReport[] = [];
  let filteredAsSensitive = 0;

  for (const event of events) {
    const { source, sensitive } = describeEventSource(registry, event.lastData);
    if (sensitive) {
      filteredAsSensitive++;
      continue;
    }

    reports.push({
      stateType: 'home_assistant_event',
      stateData: {
        eventType: event.eventType,
        ...source,
        data: compactEventData(event.lastData),
        lastFired: event.lastFiredAt,
        detectedAt,
        ...(event.occurrences > 1 && {
          occurrences: event.occurrences,
          firstFired: event.firstFiredAt,
        }),
      },
    });
  }

  return { reports, filteredAsSensitive };
}
