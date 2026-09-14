import { createMemory } from '../../memory/index.js';
import { getSubscriptionStorage } from '../../storage/index.js';
import { logger } from '../../utils/logger.js';
import { embedTexts } from '../../utils/static-embedder.js';
import type { ToolMastra } from '../../utils/tool-factory.js';
import { describeStateChangeFacets, type StateChange } from './state-change.js';
import { formatSubscriptionMatches, rankSubscriptions } from './subscription-matcher.js';

export type { StateChange } from './state-change.js';

/**
 * Where state changes go on their way to the State Change Reactor.
 *
 * This used to be a hand-rolled batcher: an in-memory queue with a five second timer, a
 * maximum batch size, a retry budget, a drop counter and a set of statistics tools. All of
 * it existed to avoid paying the reactor's system prompt once per device state change.
 *
 * Mastra's notification signals do the same job with durable records instead of a queue
 * that a restart empties. What each piece maps to:
 *
 * - The batch timer and maximum size become the delivery policy. Low-priority
 *   notifications are rolled up into a single `<notification-summary>` rather than waking
 *   the reactor once per change, which is exactly what the batching bought.
 * - The retry budget and drop counter become the record lifecycle. A delivery that fails
 *   is retried and eventually marked `failed`, rather than being counted in a statistic
 *   nothing outside the process could read.
 * - The pending queue's capacity bound is no longer needed. It existed because a
 *   sustained outage fed retries back into memory on a device with 2GB of it; records now
 *   live in storage.
 * - Duplicate suppression is new. The batcher had none, so a poll that re-reported the
 *   same change put it in front of the model again every time.
 *
 * The reactor reads the records behind a summary through its notification inbox tool.
 *
 * One deliberate behaviour change: the reactor now sees a rollup on the dispatcher's
 * cadence, which is a minute, where the batcher's window was five seconds. That is the
 * cost of the records being durable, and it is the right trade for what this carries —
 * "the sun went down, close the blinds" does not need five-second latency. Anything that
 * genuinely cannot wait belongs at a higher priority, which the default policy delivers
 * immediately rather than rolling up.
 */

/** The memory owner every state change is filed under. */
export const STATE_CHANGE_RESOURCE_ID = 'hey-jarvis-primary-user';

/** The single long-lived thread the reactor watches for state changes. */
export const STATE_CHANGE_THREAD_ID = 'hey-jarvis-state-changes';

/**
 * Renders a value as JSON with object keys in a stable order.
 *
 * `JSON.stringify` preserves insertion order, so two state changes carrying the same
 * fields in a different order would produce different text and defeat the dedupe key.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));

  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}

/**
 * The key that collapses a repeat of the same state change into the record already
 * waiting.
 *
 * Deliberately built from the whole payload rather than from the entity alone. Two
 * genuinely different readings from one sensor are two things the reactor should see;
 * only a change that is identical in every respect is a duplicate — which is what a poll
 * re-reporting its last result produces.
 */
function buildDedupeKey(change: StateChange): string {
  return `${change.source}:${change.stateType}:${stableStringify(change.stateData)}`;
}

/**
 * Retrieves the subscriptions whose WHEN/GIVEN components look relevant to a state
 * change, as a formatted shortlist.
 *
 * Matching stays on the send side rather than becoming a tool the reactor calls. It is
 * vector-only, runs in-process against a local static embedder, and costs nothing per
 * change worth deferring — and the reactor runs on a local Qwen3, which is exactly the
 * kind of model that does better with the shortlist already in front of it than with one
 * more tool it has to remember to call.
 */
async function matchSubscriptions(change: StateChange): Promise<string> {
  const storage = await getSubscriptionStorage();

  // Housekeeping on the way past. Lapsed subscriptions are already filtered out of
  // matching, so this only reclaims rows -- but it is a single DELETE against a table
  // with tens of rows, and this is the moment it is cheapest to do.
  const pruned = await storage.pruneExpired();
  if (pruned.length > 0) {
    logger.info('Pruned lapsed subscriptions', {
      count: pruned.length,
      ids: pruned.map((subscription) => subscription.id),
    });
  }

  const subscriptions = await storage.getAllEmbedded();
  if (subscriptions.length === 0) {
    return formatSubscriptionMatches([]);
  }

  // The change is rendered into several overlapping facets and scored on its best one,
  // so a long description cannot dilute a strong match in one of its parts.
  const facets = describeStateChangeFacets(change);
  const embeddings = await embedTexts(facets);

  return formatSubscriptionMatches(rankSubscriptions(embeddings, subscriptions));
}

/**
 * Writes the change to memory for recent context.
 *
 * Without semantic recall, and for the same reason it always was: this is the
 * highest-frequency writer in the system, and embedding each one with the hosted model
 * would cost a network round trip and a stored vector to make things like
 * `co2 ppm is 1400` searchable by meaning, which nothing asks for. The question that does
 * need semantics — does this event match a subscription — is answered by the local static
 * embedder in {@link matchSubscriptions} instead.
 *
 * The notification record is not a substitute for this: it belongs to the reactor's
 * inbox, whereas this is the shared memory the other agents recall from.
 */
async function saveToMemory(change: StateChange): Promise<void> {
  const memory = await createMemory({ enableSemanticRecall: false });

  await memory.saveMessages({
    messages: [
      {
        id: `state-change-${crypto.randomUUID()}`,
        role: 'system',
        content: {
          format: 2,
          parts: [
            {
              type: 'text',
              text: `State change registered: ${change.stateType} from ${change.source}. Data: ${JSON.stringify(change.stateData)}`,
            },
          ],
        },
        createdAt: new Date(),
      },
    ],
  });
}

/**
 * The id the State Change Reactor is registered under in `mastra/index.ts`.
 *
 * The reactor has to be resolved from the Mastra instance rather than built fresh:
 * `sendNotificationSignal` reaches for the notifications storage through the agent's
 * registered instance, so an agent that was constructed but never registered cannot send
 * one at all.
 */
const STATE_CHANGE_REACTOR_AGENT_ID = 'stateChangeReactor';

/** What {@link registerStateChangeNotification} reports back to its caller. */
export interface RegisteredStateChange {
  /** The inbox record the change was filed as. Repeats of one change share an id. */
  recordId: string;
  /** Whether this call collapsed into a record that was already waiting. */
  duplicate: boolean;
  /** What the delivery policy decided to do with it. */
  action: string;
}

/**
 * Files a state change as a notification for the State Change Reactor.
 *
 * Returns as soon as the record is stored. Whether the reactor is woken now or the change
 * is rolled into the next summary is the delivery policy's decision, not this function's.
 */
export async function registerStateChangeNotification(
  change: StateChange,
  mastra: ToolMastra,
): Promise<RegisteredStateChange> {
  logger.info('Registering state change', {
    stateType: change.stateType,
    source: change.source,
  });

  const reactorAgent = mastra.getAgentById(STATE_CHANGE_REACTOR_AGENT_ID);
  const [matchedSubscriptions] = await Promise.all([matchSubscriptions(change), saveToMemory(change)]);

  const result = await reactorAgent.sendNotificationSignal(
    {
      source: change.source,
      kind: change.stateType,
      // The summary is what the model reads inline when this delivers on its own. The
      // payload is what it gets from the inbox tool after a rollup, so the candidate
      // subscriptions have to be in the payload -- a summary line cannot carry them.
      summary: `${change.stateType} from ${change.source}: ${JSON.stringify(change.stateData)}`,
      payload: {
        source: change.source,
        stateType: change.stateType,
        stateData: change.stateData,
        matchedSubscriptions,
      },
      // Everything arrives low, which is what makes the default policy roll changes up
      // instead of waking the reactor once each -- the job the batch timer used to do.
      // Urgency is the reactor's call to make once it has the context, not the caller's
      // at the point of detection.
      priority: 'low',
      dedupeKey: buildDedupeKey(change),
    },
    {
      resourceId: STATE_CHANGE_RESOURCE_ID,
      threadId: STATE_CHANGE_THREAD_ID,
    },
  );

  // `coalescedCount` is the number of times this change has been filed, so the first one
  // is 1, not 0. Anything above that collapsed into a record already waiting.
  const duplicate = (result.record.coalescedCount ?? 1) > 1;

  logger.info('State change filed as a notification', {
    stateType: change.stateType,
    source: change.source,
    recordId: result.record.id,
    action: result.decision.action,
    duplicate,
  });

  return {
    recordId: result.record.id,
    duplicate,
    action: result.decision.action,
  };
}
