import type { StorageDomains } from '@mastra/core/storage';
import type { ObservabilityLogStorage } from './observability-logs.js';

/** The observability domain of a Mastra storage adapter. */
export type ObservabilityStore = NonNullable<StorageDomains['observability']>;

/**
 * The observability methods `@mastra/libsql` does not implement, by the store that
 * answers them instead.
 *
 * Mastra's observability domain covers spans, logs, metrics, scores *and* feedback. LibSQL
 * implements spans and leaves the rest to the base class in `@mastra/core`, which turns
 * each missing method into a throw. Two of those surfaces matter here:
 *
 * - Feedback, the thumbs up/down a reviewer leaves on a trace in Studio. Studio polls
 *   `/observability/feedback` on its own, so unanswered the server returns 500 and logs a
 *   stack trace every time the observability page is open.
 * - Logs. The exporter drops every log it cannot write, and Studio's Logs page reports
 *   "Logs are not available with your current storage".
 *
 * Kept as explicit lists rather than sniffed at runtime: the base class defines these
 * as real methods that throw, so there is nothing to feature-detect against.
 */
const FEEDBACK_METHODS: ReadonlySet<PropertyKey> = new Set([
  'createFeedback',
  'batchCreateFeedback',
  'listFeedback',
  'getFeedbackAggregate',
  'getFeedbackBreakdown',
  'getFeedbackTimeSeries',
  'getFeedbackPercentiles',
]);

const LOG_METHODS: ReadonlySet<PropertyKey> = new Set(['batchCreateLogs', 'listLogs']);

/** The stores standing in for the surfaces the durable store lacks. */
export interface ObservabilityFallbacks {
  feedback: ObservabilityStore;
  logs: ObservabilityLogStorage;
}

/**
 * Serves feedback and logs from their fallbacks, and everything else from `durable`.
 *
 * Mastra composes storage per *domain*, not per method, so a store that implements most
 * of a domain cannot be topped up through `MastraCompositeStore`. Routing the whole
 * domain to a fallback would give up the durable spans — the traces this project
 * actually keeps. This splits the difference at the only seam that matters.
 *
 * Methods are bound to whichever store they came from: the implementations reach
 * private fields through `this`, and a private field is not readable through a proxy,
 * so an unbound method called off this object throws before it does any work.
 *
 * `constructor` is left alone. It is a function but never a method call on the store,
 * and binding it renames the class — Mastra builds storage error identifiers out of
 * store names, and `bound ObservabilityLibSQL` has no business appearing in one.
 *
 * @param durable - The adapter backing spans and everything else not listed above
 * @param fallbacks - The stores backing the feedback and log methods listed above
 * @returns An observability store delegating each method to the right one of the three
 */
export function withFallbacks(
  durable: ObservabilityStore,
  { feedback, logs }: ObservabilityFallbacks,
): ObservabilityStore {
  return new Proxy(durable, {
    get(target, property) {
      const source: object = FEEDBACK_METHODS.has(property) ? feedback : LOG_METHODS.has(property) ? logs : target;
      const value: unknown = Reflect.get(source, property, source);

      return typeof value === 'function' && property !== 'constructor' ? value.bind(source) : value;
    },
  });
}
