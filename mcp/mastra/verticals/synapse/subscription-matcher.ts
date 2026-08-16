/**
 * Subscription Matching
 *
 * Turns an incoming state change into a shortlist of subscriptions worth showing
 * to the LLM. Matching is purely vector-based — every subscription's `whenEvent` and
 * `givenCondition` components were embedded at registration time with Model2Vec (potion),
 * so scoring the whole subscription set against a state change costs a single
 * embedding plus a handful of dot products.
 *
 * This is deliberately a *recall* step, not a decision step: it is tuned to be
 * generous, and the reactor agent makes the final call on whether the `thenAction`
 * should actually run.
 */

import { getSubscriptionStorage } from '../../storage/index.js';
import type { EmbeddedSubscription, Subscription } from '../../storage/subscriptions.js';
import { logger } from '../../utils/logger.js';
import { cosineSimilarity, embedText } from '../../utils/static-embedder.js';
import { describeStateChange, type StateChange } from './state-change.js';

/**
 * Minimum similarity for a subscription to be considered relevant.
 *
 * Potion embeddings put unrelated sentences near 0 and loose paraphrases around
 * 0.35–0.5, so this sits just below "vaguely on topic" — recall matters more
 * than precision here because the LLM filters afterwards.
 */
export const DEFAULT_MINIMUM_SCORE = 0.3;

/** Maximum number of subscriptions handed to the LLM for one state change. */
export const DEFAULT_MAXIMUM_MATCHES = 5;

export interface SubscriptionMatch {
  subscription: Subscription;
  /** Similarity between the state change and the subscription's `whenEvent`. */
  whenScore: number;
  /** Similarity against the `givenCondition`, or null when the subscription has none. */
  givenScore: number | null;
  /** The score the shortlist is ranked by: the stronger of the two components. */
  score: number;
}

export interface SubscriptionMatchOptions {
  /** Similarity floor. Defaults to {@link DEFAULT_MINIMUM_SCORE}. */
  minimumScore?: number;
  /** Shortlist size. Defaults to {@link DEFAULT_MAXIMUM_MATCHES}. */
  maximumMatches?: number;
  /** Also score subscriptions that have been disabled. Defaults to false. */
  includeDisabled?: boolean;
}

/**
 * Finds the subscriptions most relevant to a free-text description of something
 * that happened.
 *
 * A subscription matches on *either* of its observable components: the `whenEvent`
 * (the event it waits for) or the `givenCondition` (the precondition it cares about).
 * A state change can just as easily be "the lights turned on" — which is a
 * `givenCondition` for one subscription and a `whenEvent` for another — so the higher of the
 * two similarities is used for ranking, and both are reported so the LLM can see
 * which part actually matched.
 *
 * @param description - Natural-language description of the state change
 * @param options - Score floor, shortlist size, and whether to include disabled subscriptions
 * @returns Matches above the score floor, strongest first
 */
export async function findRelevantSubscriptions(
  description: string,
  options: SubscriptionMatchOptions = {},
): Promise<SubscriptionMatch[]> {
  const storage = await getSubscriptionStorage();
  const subscriptions = await storage.getAllEmbedded({ includeDisabled: options.includeDisabled ?? false });

  if (subscriptions.length === 0) {
    return [];
  }

  const descriptionEmbedding = await embedText(description);
  const matches = rankSubscriptions(descriptionEmbedding, subscriptions, options);

  logger.info('[SYNAPSE] Matched subscriptions', {
    description,
    candidateCount: subscriptions.length,
    matchCount: matches.length,
  });

  return matches;
}

/**
 * Scores an already-embedded description against already-embedded subscriptions.
 *
 * Split out from {@link findRelevantSubscriptions} so the ranking rules can be
 * exercised (and reused) without touching storage.
 *
 * @param descriptionEmbedding - Embedding of what happened
 * @param subscriptions - Subscriptions with their `whenEvent`/`givenCondition` embeddings
 * @param options - Score floor and shortlist size
 * @returns Matches above the score floor, strongest first
 */
export function rankSubscriptions(
  descriptionEmbedding: Float32Array,
  subscriptions: EmbeddedSubscription[],
  options: SubscriptionMatchOptions = {},
): SubscriptionMatch[] {
  const { minimumScore = DEFAULT_MINIMUM_SCORE, maximumMatches = DEFAULT_MAXIMUM_MATCHES } = options;

  return subscriptions
    .map(({ whenEmbedding, givenEmbedding, ...subscription }) => {
      const whenScore = cosineSimilarity(descriptionEmbedding, whenEmbedding);
      const givenScore = givenEmbedding ? cosineSimilarity(descriptionEmbedding, givenEmbedding) : null;

      return {
        subscription,
        whenScore,
        givenScore,
        score: Math.max(whenScore, givenScore ?? Number.NEGATIVE_INFINITY),
      };
    })
    .filter((match) => match.score >= minimumScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, maximumMatches);
}

/**
 * Convenience wrapper around {@link findRelevantSubscriptions} that renders the
 * state change into a description first.
 *
 * @param change - The state change to match against
 * @param options - Score floor, shortlist size, and whether to include disabled subscriptions
 */
export async function findSubscriptionsForStateChange(
  change: StateChange,
  options: SubscriptionMatchOptions = {},
): Promise<SubscriptionMatch[]> {
  return await findRelevantSubscriptions(describeStateChange(change), options);
}

/**
 * Renders matches as a prompt fragment for the reactor agent.
 *
 * All three components are included — the LLM needs the `thenAction` to decide what
 * action a match implies, even though only `whenEvent` and `givenCondition` were scored.
 *
 * @param matches - Matches to render, strongest first
 */
export function formatSubscriptionMatches(matches: SubscriptionMatch[]): string {
  if (matches.length === 0) {
    return 'No subscriptions matched this state change.';
  }

  return matches
    .map((match, index) => {
      const { subscription, whenScore, givenScore } = match;
      const lines = [
        `${index + 1}. Subscription ${subscription.id}${subscription.oneShot ? ' (one-shot)' : ''}`,
        `   WHEN: ${subscription.whenEvent} (similarity ${whenScore.toFixed(2)})`,
      ];

      if (subscription.givenCondition) {
        lines.push(`   GIVEN: ${subscription.givenCondition} (similarity ${givenScore?.toFixed(2) ?? 'n/a'})`);
      }

      lines.push(`   THEN: ${subscription.thenAction}`);

      if (subscription.lastTriggeredAt) {
        lines.push(`   Last triggered: ${subscription.lastTriggeredAt} (${subscription.triggerCount}x)`);
      }

      return lines.join('\n');
    })
    .join('\n\n');
}
