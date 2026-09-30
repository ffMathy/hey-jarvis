/**
 * Rolls the Home Assistant event stream up into one report per entity or event source.
 *
 * The websocket delivers every change the moment it happens, which is exactly what the old
 * three-hourly poll could not do -- and also exactly what the State Change Reactor must not be
 * handed raw. A power meter reports every few seconds, a flaky Zigbee sensor flaps between
 * `unavailable` and a reading, a button fires a burst of `zha_event`s for one press. Passed on
 * one at a time, each of those would be its own record in the reactor's inbox.
 *
 * So changes are collected into a bucket per key and a bucket is only released once it has
 * been open for its window:
 *
 * - A quiet key (fewer than {@link BulkingPolicy.spammyThreshold} changes so far) is released
 *   after {@link BulkingPolicy.quietWindowMs}. A door opening is reported within that window,
 *   with any close that followed it folded in.
 * - A key that crosses the threshold is spammy, and its bucket is held open for the much longer
 *   {@link BulkingPolicy.spammyWindowMs}. Everything it reports in that time becomes a single
 *   report with a count, the first and last value, and the distinct values in between.
 *
 * The bulker is deliberately pure -- no timers, no I/O, the clock passed in -- so the rules
 * above are tested directly rather than through a socket. The monitor owns the ticking.
 */

/** How long buckets stay open, and what makes a key spammy. */
export interface BulkingPolicy {
  /** How long a bucket collects changes before it is released, while its key is quiet. */
  quietWindowMs: number;
  /** How long a bucket collects changes once its key has been found spammy. */
  spammyWindowMs: number;
  /** The number of changes in one bucket at which its key counts as spammy. */
  spammyThreshold: number;
  /** The most distinct intermediate values a report carries; the rest are counted, not listed. */
  maxObservedValues: number;
}

export const DEFAULT_BULKING_POLICY: BulkingPolicy = {
  quietWindowMs: 30_000,
  spammyWindowMs: 10 * 60_000,
  spammyThreshold: 5,
  maxObservedValues: 10,
};

/** One entity changing its state, as the monitor hands it over. */
export interface EntityStateChange {
  entityId: string;
  oldState: string;
  newState: string;
  changedAt: string;
}

/** A state change bucket as it is released: everything one entity did while it was open. */
export interface BulkedStateChange {
  entityId: string;
  /** The state before the first change in the bucket. */
  previousState: string;
  /** The state after the last change in the bucket. */
  newState: string;
  /** Every distinct state the entity passed through, in order of first appearance, capped. */
  observedStates: string[];
  changeCount: number;
  firstChangedAt: string;
  lastChangedAt: string;
  /** Whether the bucket was held open because its entity was spammy. */
  spammy: boolean;
}

/** One Home Assistant event other than a state change. */
export interface HomeAssistantBusEvent {
  eventType: string;
  data: Record<string, unknown>;
  firedAt: string;
}

/** An event bucket as it is released: every event of one type from one source. */
export interface BulkedBusEvent {
  eventType: string;
  /** The entity or device the events came from, when they name one. */
  sourceId: string | undefined;
  /** The payload of the most recent event in the bucket. */
  lastData: Record<string, unknown>;
  occurrences: number;
  firstFiredAt: string;
  lastFiredAt: string;
  spammy: boolean;
}

interface StateBucket {
  openedAt: number;
  change: BulkedStateChange;
}

interface EventBucket {
  openedAt: number;
  event: BulkedBusEvent;
}

/**
 * The entity or device an event is about, so that a burst from one button is bulked together
 * while a press on another button still gets a report of its own.
 */
export function eventSourceId(data: Record<string, unknown>): string | undefined {
  for (const key of ['entity_id', 'device_id', 'device_ieee', 'unique_id', 'id'] as const) {
    const value = data[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

export class ChangeBulker {
  private readonly stateBuckets = new Map<string, StateBucket>();
  private readonly eventBuckets = new Map<string, EventBucket>();

  constructor(private readonly policy: BulkingPolicy = DEFAULT_BULKING_POLICY) {}

  /** The number of buckets waiting to be released. */
  get pendingCount(): number {
    return this.stateBuckets.size + this.eventBuckets.size;
  }

  addStateChange(change: EntityStateChange, now: number): void {
    const bucket = this.stateBuckets.get(change.entityId);

    if (!bucket) {
      this.stateBuckets.set(change.entityId, {
        openedAt: now,
        change: {
          entityId: change.entityId,
          previousState: change.oldState,
          newState: change.newState,
          observedStates: [change.newState],
          changeCount: 1,
          firstChangedAt: change.changedAt,
          lastChangedAt: change.changedAt,
          spammy: false,
        },
      });
      return;
    }

    const bulked = bucket.change;
    bulked.newState = change.newState;
    bulked.changeCount++;
    bulked.lastChangedAt = change.changedAt;
    bulked.spammy = bulked.changeCount >= this.policy.spammyThreshold;
    if (
      !bulked.observedStates.includes(change.newState) &&
      bulked.observedStates.length < this.policy.maxObservedValues
    ) {
      bulked.observedStates.push(change.newState);
    }
  }

  addEvent(event: HomeAssistantBusEvent, now: number): void {
    const sourceId = eventSourceId(event.data);
    const key = `${event.eventType}\u0000${sourceId ?? ''}`;
    const bucket = this.eventBuckets.get(key);

    if (!bucket) {
      this.eventBuckets.set(key, {
        openedAt: now,
        event: {
          eventType: event.eventType,
          sourceId,
          lastData: event.data,
          occurrences: 1,
          firstFiredAt: event.firedAt,
          lastFiredAt: event.firedAt,
          spammy: false,
        },
      });
      return;
    }

    const bulked = bucket.event;
    bulked.lastData = event.data;
    bulked.occurrences++;
    bulked.lastFiredAt = event.firedAt;
    bulked.spammy = bulked.occurrences >= this.policy.spammyThreshold;
  }

  /**
   * Releases every bucket whose window has elapsed, and forgets it.
   *
   * @param now - The current time; buckets opened at least one window before it are released
   * @param force - Release everything regardless of age, for shutdown
   */
  drain(now: number, force = false): { states: BulkedStateChange[]; events: BulkedBusEvent[] } {
    const states: BulkedStateChange[] = [];
    const events: BulkedBusEvent[] = [];

    for (const [key, bucket] of this.stateBuckets) {
      if (force || this.isRipe(bucket.openedAt, bucket.change.spammy, now)) {
        states.push(bucket.change);
        this.stateBuckets.delete(key);
      }
    }

    for (const [key, bucket] of this.eventBuckets) {
      if (force || this.isRipe(bucket.openedAt, bucket.event.spammy, now)) {
        events.push(bucket.event);
        this.eventBuckets.delete(key);
      }
    }

    return { states, events };
  }

  private isRipe(openedAt: number, spammy: boolean, now: number): boolean {
    const window = spammy ? this.policy.spammyWindowMs : this.policy.quietWindowMs;
    return now - openedAt >= window;
  }
}
