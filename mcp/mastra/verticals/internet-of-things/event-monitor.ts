import {
  type Connection,
  createConnection,
  createLongLivedTokenAuth,
  getStates,
  type HassEntity,
  type HassEvent,
  type StateChangedEvent,
} from 'home-assistant-js-websocket';
import { getDeviceStateStorage, getEntityNoiseBaselineStorage } from '../../storage/index.js';
import { logger } from '../../utils/logger.js';
import { executeTool, type ToolMastra } from '../../utils/tool-factory.js';
import {
  isLastNotificationSensor,
  isNotificationSensor,
  readNotificationAttributes,
  toNotificationStateChange,
} from '../phone/notifications.js';
import { findSubscriptionsForStateChange } from '../synapse/subscription-matcher.js';
import { registerStateChange } from '../synapse/tools.js';
import { type BulkingPolicy, ChangeBulker, DEFAULT_BULKING_POLICY } from './change-bulker.js';
import {
  createRelevanceLookup,
  type EntityDetails,
  getChangeRelevanceClassifier,
  type ReportTriageDependencies,
  type TriagedReport,
  triageReports,
} from './change-relevance.js';
import {
  describeEntity,
  type HomeRegistry,
  type PlannedReport,
  planEventReports,
  planStateReports,
} from './change-reports.js';
import { getHomeAssistantConfig } from './tools.js';

/**
 * Watches Home Assistant over its websocket API and files what happens in the house as state
 * changes for the State Change Reactor.
 *
 * This replaced a workflow that ran every three hours and rendered a template listing every
 * entity whose `last_changed` fell inside that window. That could only ever see the latest
 * state of each entity -- a door opened and closed again between two polls was invisible --
 * reported up to three hours late, and could not see events at all, only states.
 *
 * Now a single subscription to the event bus delivers everything as it happens:
 *
 * - `state_changed` events whose state value moved. Attribute-only updates are dropped here,
 *   which is where most of the bus traffic is, and matches the `last_changed` semantics the
 *   poll used.
 * - Every other event, apart from the {@link IGNORED_EVENT_TYPES} that are Home Assistant's
 *   own bookkeeping. This is what brings button presses, doorbell rings, tag scans and the
 *   like -- things that happen without any entity's state changing -- to the reactor.
 *
 * Both go through the {@link ChangeBulker}, which is what keeps a chatty sensor from
 * becoming a flood: see there for the windows. Released buckets are filtered for the
 * `sensitive` label and, for states, against the entity's noise baseline before being filed.
 * What survives is sorted by what kind of thing it is about (see `change-relevance.ts`):
 * diagnostics nobody subscribed to are dropped, and safety and security are filed high.
 *
 * On every connect, and every reconnect after a drop, the current states are fetched and
 * compared against the last ones seen, so what changed while the process was down or the
 * socket was dropped is still reported -- the job `runOnStartup` did for the poll.
 */

/** How often the bulker is checked for buckets whose window has elapsed. */
const FLUSH_INTERVAL_MS = 5_000;

/** The source every report is filed under, shared with the rest of the IoT vertical. */
const SOURCE = 'internet-of-things';

/**
 * Events that describe Home Assistant rather than the house.
 *
 * `call_service` is here on purpose: every service call -- Jarvis's own included -- shows up
 * as the state changes it causes, which are reported already. So are `automation_triggered`
 * and `script_started`: they are the house reacting to something that has itself been
 * reported, and they are among the chattiest events on the bus.
 */
export const IGNORED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'state_changed',
  'state_reported',
  'call_service',
  'automation_triggered',
  'script_started',
  'automation_reloaded',
  'scene_reloaded',
  'service_registered',
  'service_removed',
  'component_loaded',
  'core_config_updated',
  'homeassistant_start',
  'homeassistant_started',
  'homeassistant_stop',
  'homeassistant_final_write',
  'homeassistant_close',
  'logbook_entry',
  'system_log_event',
  'recorder_5min_statistics_generated',
  'recorder_hourly_statistics_generated',
  'entity_registry_updated',
  'device_registry_updated',
  'area_registry_updated',
  'floor_registry_updated',
  'label_registry_updated',
  'category_registry_updated',
  'config_entry_discovered',
  'data_entry_flow_progressed',
  'repairs_issue_registry_updated',
  'panels_updated',
  'themes_updated',
  'lovelace_updated',
  'lovelace_resources_updated',
  'persistent_notifications_updated',
  'user_added',
  'user_updated',
  'user_removed',
  'timer_out_of_sync',
]);

/** Registry events after which the cached labels and device names may be out of date. */
const REGISTRY_EVENT_TYPES: ReadonlySet<string> = new Set(['entity_registry_updated', 'device_registry_updated']);

interface EntityRegistryEntry {
  entity_id: string;
  device_id: string | null;
  labels?: string[];
}

interface DeviceRegistryEntry {
  id: string;
  name: string | null;
  name_by_user: string | null;
  labels?: string[];
}

function isStateChangedEvent(event: HassEvent): event is StateChangedEvent {
  return event.event_type === 'state_changed';
}

async function fetchRegistry(connection: Connection): Promise<HomeRegistry> {
  const [entities, devices] = await Promise.all([
    connection.sendMessagePromise<EntityRegistryEntry[]>({ type: 'config/entity_registry/list' }),
    connection.sendMessagePromise<DeviceRegistryEntry[]>({ type: 'config/device_registry/list' }),
  ]);

  return {
    entities: new Map(
      entities.map((entry) => [entry.entity_id, { deviceId: entry.device_id, labels: entry.labels ?? [] }]),
    ),
    devices: new Map(
      devices.map((entry) => [
        entry.id,
        { name: entry.name_by_user ?? entry.name ?? 'Unknown Device', labels: entry.labels ?? [] },
      ]),
    ),
  };
}

/** A running monitor. */
export interface HomeAssistantEventMonitor {
  /** Stops listening, and files whatever was still waiting in the bulker. */
  stop(): Promise<void>;
}

export interface EventMonitorOptions {
  policy?: BulkingPolicy;
}

/**
 * Connects to Home Assistant and starts reporting what happens there.
 *
 * Resolves once the monitor is running; the first connection is made in the background and
 * retried until it succeeds, so an unreachable Home Assistant delays the reports rather than
 * the server's boot. Resolves to `undefined` when no Home Assistant is configured at all.
 */
export async function startHomeAssistantEventMonitor(
  mastra: ToolMastra,
  options: EventMonitorOptions = {},
): Promise<HomeAssistantEventMonitor | undefined> {
  let config: { url: string; token: string };
  try {
    config = getHomeAssistantConfig();
  } catch (error) {
    logger.warn('Home Assistant is not configured; not monitoring its events', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }

  const bulker = new ChangeBulker(options.policy ?? DEFAULT_BULKING_POLICY);
  const deviceStateStorage = await getDeviceStateStorage();
  const noiseBaselineStorage = await getEntityNoiseBaselineStorage();

  // The last state seen for each entity, whether it came off the socket or out of storage.
  // Catch-up compares against this rather than storage alone, because a change still waiting
  // in the bulker has not been written yet and would otherwise be reported twice.
  const lastKnownStates = new Map<string, string>();
  for (const [entityId, stored] of await deviceStateStorage.getAllStates()) {
    lastKnownStates.set(entityId, stored.state);
  }

  // Each entity's name and device class, as its state attributes last gave them. The change
  // relevance classifier is told what an entity is from these, and they only arrive with a state.
  const entityDetails = new Map<string, EntityDetails>();
  const rememberEntityDetails = (entityId: string, attributes: HassEntity['attributes']): void => {
    entityDetails.set(entityId, { friendlyName: attributes.friendly_name, deviceClass: attributes.device_class });
  };

  let connection: Connection | undefined;
  let registry: HomeRegistry = { entities: new Map(), devices: new Map() };
  let registryStale = true;
  let flushing: Promise<void> | undefined;
  let stopped = false;

  const refreshRegistryIfStale = async (): Promise<void> => {
    if (!registryStale || !connection) {
      return;
    }
    registry = await fetchRegistry(connection);
    registryStale = false;
  };

  /**
   * Files a phone notification with Synapse as it arrives.
   *
   * Not bulked: each notification is its own message, and bulking would reduce a burst of
   * them to the first and last. Rolling them up is left to the reactor's delivery policy,
   * which does it without losing any.
   */
  const fileNotification = (entityId: string, attributes: Record<string, unknown>): void => {
    if (describeEntity(registry, entityId).sensitive) {
      return;
    }

    const notification = readNotificationAttributes(attributes);
    const stateChange = notification ? toNotificationStateChange(notification) : null;
    if (!stateChange) {
      return;
    }

    void executeTool(registerStateChange, stateChange, { mastra }).catch((error) =>
      logger.error('Filing a phone notification failed', { entityId, error }),
    );
  };

  const onStateChanged = (event: StateChangedEvent): void => {
    const { entity_id: entityId, old_state: oldState, new_state: newState } = event.data;

    // The notification sensors' state is the text of a notification, so none of it belongs
    // in the device reports. The last-notification sensor is read on every update, attribute-
    // only ones included: two notifications in a row with the same text differ only there.
    if (isNotificationSensor(entityId)) {
      if (newState && isLastNotificationSensor(entityId)) {
        fileNotification(entityId, newState.attributes);
      }
      return;
    }

    // An entity being added or removed is registry churn, and an attribute-only update is
    // most of the bus's traffic; neither is a change in what the entity reports.
    if (!oldState || !newState || oldState.state === newState.state) {
      return;
    }

    lastKnownStates.set(entityId, newState.state);
    rememberEntityDetails(entityId, newState.attributes);
    bulker.addStateChange(
      { entityId, oldState: oldState.state, newState: newState.state, changedAt: newState.last_changed },
      Date.now(),
    );
  };

  const onEvent = (event: HassEvent): void => {
    if (isStateChangedEvent(event)) {
      onStateChanged(event);
      return;
    }

    if (REGISTRY_EVENT_TYPES.has(event.event_type)) {
      registryStale = true;
    }

    if (IGNORED_EVENT_TYPES.has(event.event_type)) {
      return;
    }

    bulker.addEvent({ eventType: event.event_type, data: event.data, firedAt: event.time_fired }, Date.now());
  };

  /** Feeds whatever changed while the socket was down into the bulker, and seeds unseen entities. */
  const catchUp = async (): Promise<void> => {
    if (!connection) {
      return;
    }

    registryStale = true;
    await refreshRegistryIfStale();
    const states: HassEntity[] = await getStates(connection);
    const now = Date.now();
    let caughtUp = 0;
    let seeded = 0;

    for (const entity of states) {
      // A notification posted while the socket was down is not caught up on: the sensor holds
      // only the latest one, and it may be hours old by now.
      if (describeEntity(registry, entity.entity_id).sensitive || isNotificationSensor(entity.entity_id)) {
        continue;
      }

      const known = lastKnownStates.get(entity.entity_id);
      lastKnownStates.set(entity.entity_id, entity.state);
      rememberEntityDetails(entity.entity_id, entity.attributes);

      if (known === undefined) {
        await deviceStateStorage.updateState(entity.entity_id, entity.state, {}, entity.last_changed);
        seeded++;
      } else if (known !== entity.state) {
        bulker.addStateChange(
          { entityId: entity.entity_id, oldState: known, newState: entity.state, changedAt: entity.last_changed },
          now,
        );
        caughtUp++;
      }
    }

    logger.info('Caught up on Home Assistant states', { entities: states.length, changed: caughtUp, seeded });
  };

  const fileReports = async (reports: TriagedReport[]): Promise<void> => {
    for (const { report, priority } of reports) {
      await executeTool(
        registerStateChange,
        { source: SOURCE, stateType: report.stateType, stateData: report.stateData, priority },
        { mastra },
      );
    }
  };

  const triageDependencies: ReportTriageDependencies = {
    relevanceOf: createRelevanceLookup(getChangeRelevanceClassifier()),
    hasMatchingSubscription: async (report: PlannedReport) =>
      (await findSubscriptionsForStateChange({ source: SOURCE, ...report })).length > 0,
  };

  const flush = async (force = false): Promise<void> => {
    const { states, events } = bulker.drain(Date.now(), force);
    if (states.length === 0 && events.length === 0) {
      return;
    }

    try {
      await refreshRegistryIfStale();
    } catch (error) {
      // A stale registry is still better than none: it only risks missing a label that was
      // added in the last few seconds.
      logger.warn('Could not refresh the Home Assistant registry; using the cached one', { error });
    }

    const detectedAt = new Date().toISOString();
    const baselines = await noiseBaselineStorage.getAllBaselines();
    const statePlan = planStateReports(states, registry, baselines, detectedAt);
    const eventPlan = planEventReports(events, registry, detectedAt);

    for (const change of states) {
      if (!describeEntity(registry, change.entityId).sensitive) {
        await deviceStateStorage.updateState(change.entityId, change.newState, {}, change.lastChangedAt);
      }
    }

    const { filed, droppedAsDiagnostics } = await triageReports(
      [...statePlan.reports, ...eventPlan.reports],
      entityDetails,
      triageDependencies,
    );
    await fileReports(filed);

    if (droppedAsDiagnostics.length > 0) {
      logger.info('Diagnostic Home Assistant changes not reported', {
        subjects: droppedAsDiagnostics.map((report) => report.stateData.entityId ?? report.stateData.eventType),
      });
    }

    logger.info('Home Assistant changes flushed', {
      stateBuckets: states.length,
      eventBuckets: events.length,
      spammyBuckets: states.filter((change) => change.spammy).length + events.filter((event) => event.spammy).length,
      reported: filed.length,
      reportedAsHighPriority: filed.filter((report) => report.priority === 'high').length,
      filteredAsNoise: statePlan.filteredAsNoise,
      filteredAsSensitive: statePlan.filteredAsSensitive + eventPlan.filteredAsSensitive,
      filteredAsDiagnostics: droppedAsDiagnostics.length,
    });
  };

  const tick = (): void => {
    // One flush at a time: a slow one would otherwise overlap the next tick and report the
    // same entity out of order.
    if (flushing) {
      return;
    }
    flushing = flush()
      .catch((error) => logger.error('Flushing Home Assistant changes failed', { error }))
      .finally(() => {
        flushing = undefined;
      });
  };

  const timer = setInterval(tick, FLUSH_INTERVAL_MS);

  const connect = async (): Promise<void> => {
    const hassUrl = config.url.replace(/\/+$/, '');
    // A negative setupRetry retries the first connection until it succeeds. Invalid auth is
    // the one failure it gives up on, since retrying cannot fix a wrong token.
    const opened = await createConnection({ auth: createLongLivedTokenAuth(hassUrl, config.token), setupRetry: -1 });
    if (stopped) {
      opened.close();
      return;
    }
    connection = opened;

    connection.addEventListener('ready', () => {
      logger.info('Reconnected to Home Assistant');
      void catchUp().catch((error) => logger.error('Catching up on Home Assistant states failed', { error }));
    });
    connection.addEventListener('disconnected', () => {
      logger.warn('Lost the connection to Home Assistant; reconnecting');
    });

    // One subscription to every event: subscribed per type, the ones that matter most --
    // integration events like button presses -- could never be listed in advance.
    await connection.subscribeEvents<HassEvent>(onEvent);
    logger.info('Monitoring Home Assistant events over its websocket API', { haVersion: connection.haVersion });
    await catchUp();
  };

  void connect().catch((error) => logger.error('Could not start monitoring Home Assistant events', { error }));

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      connection?.close();
      await flushing;
      await flush(true);
    },
  };
}
