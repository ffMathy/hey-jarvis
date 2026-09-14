import type { StorageDomains } from '@mastra/core/storage';

/** The observability domain of a Mastra storage adapter. */
export type ObservabilityStore = NonNullable<StorageDomains['observability']>;

/**
 * The observability methods `@mastra/libsql` does not implement.
 *
 * Mastra's observability domain covers spans, logs, metrics, scores *and* feedback —
 * the thumbs up/down a reviewer leaves on a trace in Studio. LibSQL implements every
 * surface except feedback, and the base class in `@mastra/core` turns each missing one
 * into a throw ("This storage provider does not support listing feedback"). Studio polls
 * `/observability/feedback` on its own, so with LibSQL wired in as Mastra's storage the
 * server answers 500 and logs a stack trace every time the observability page is open.
 *
 * Kept as an explicit list rather than sniffed at runtime: the base class defines these
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

/**
 * Serves the feedback half of the observability domain from `feedback`, and everything
 * else from `durable`.
 *
 * Mastra composes storage per *domain*, not per method, so a store that implements most
 * of a domain cannot be topped up through `MastraCompositeStore`. Routing the whole
 * domain to the fallback would give up durable spans and scores — the traces this
 * project actually keeps — to gain a surface nothing here writes to. This splits the
 * difference at the only seam that matters.
 *
 * Methods are bound to whichever store they came from: both implementations reach
 * private fields through `this`, and a private field is not readable through a proxy,
 * so an unbound method called off this object throws before it does any work.
 *
 * `constructor` is left alone. It is a function but never a method call on the store,
 * and binding it renames the class — Mastra builds storage error identifiers out of
 * store names, and `bound ObservabilityLibSQL` has no business appearing in one.
 *
 * @param durable - The adapter backing spans, logs, metrics and scores
 * @param feedback - The adapter backing the feedback methods listed above
 * @returns An observability store delegating each method to the right one of the two
 */
export function withFeedbackFrom(durable: ObservabilityStore, feedback: ObservabilityStore): ObservabilityStore {
  return new Proxy(durable, {
    get(target, property) {
      const source: object = FEEDBACK_METHODS.has(property) ? feedback : target;
      const value: unknown = Reflect.get(source, property, source);

      return typeof value === 'function' && property !== 'constructor' ? value.bind(source) : value;
    },
  });
}
