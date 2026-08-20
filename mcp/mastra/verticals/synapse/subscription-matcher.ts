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
import { cosineSimilarity, embedTexts } from '../../utils/static-embedder.js';
import { describeStateChangeFacets, type StateChange } from './state-change.js';

/**
 * Minimum similarity for a subscription to be considered relevant.
 *
 * Potion embeddings put unrelated sentences near 0 and loose paraphrases around
 * 0.35–0.5, so this sits just below "vaguely on topic" — recall matters more
 * than precision here because the LLM filters afterwards.
 */
export const DEFAULT_MINIMUM_SCORE = 0.3;

/**
 * Best similarity between any facet of what happened and any phrasing of one
 * subscription component.
 *
 * Both sides are deliberately plural. A state change is embedded as several
 * overlapping fragments so that a long description cannot dilute a strong match in one
 * of its parts, and a subscription carries a third-person rewrite alongside the user's
 * own wording so it is reachable from either. Taking the maximum means neither can make
 * matching worse than it was with a single vector on each side.
 */
function bestSimilarity(facets: Float32Array[], components: Array<Float32Array | null>): number {
  let best = Number.NEGATIVE_INFINITY;

  for (const facet of facets) {
    for (const component of components) {
      if (component) {
        best = Math.max(best, cosineSimilarity(facet, component));
      }
    }
  }

  return best;
}

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

  const matches = rankSubscriptions(await embedTexts([description]), subscriptions, options);

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
 * @param descriptionEmbedding - Embedding of what happened, or several embeddings when
 *   the state change was rendered into overlapping facets
 * @param subscriptions - Subscriptions with their `whenEvent`/`givenCondition` embeddings
 * @param options - Score floor and shortlist size
 * @returns Matches above the score floor, strongest first
 */
export function rankSubscriptions(
  descriptionEmbedding: Float32Array | Float32Array[],
  subscriptions: EmbeddedSubscription[],
  options: SubscriptionMatchOptions = {},
): SubscriptionMatch[] {
  const { minimumScore = DEFAULT_MINIMUM_SCORE, maximumMatches = DEFAULT_MAXIMUM_MATCHES } = options;
  // A single embedding is still accepted, so a caller that has only a description in
  // hand does not have to know about facets.
  const facets = Array.isArray(descriptionEmbedding) ? descriptionEmbedding : [descriptionEmbedding];

  return subscriptions
    .map(({ whenEmbedding, givenEmbedding, whenAltEmbedding, givenAltEmbedding, ...subscription }) => {
      const whenScore = bestSimilarity(facets, [whenEmbedding, whenAltEmbedding]);
      const givenScore = givenEmbedding ? bestSimilarity(facets, [givenEmbedding, givenAltEmbedding]) : null;

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
  const storage = await getSubscriptionStorage();
  const subscriptions = await storage.getAllEmbedded({ includeDisabled: options.includeDisabled ?? false });

  if (subscriptions.length === 0) {
    return [];
  }

  // Facets rather than one description: see describeStateChangeFacets for why, and for
  // the measurement that justifies the extra embeddings.
  const facets = await embedTexts(describeStateChangeFacets(change));
  const matches = rankSubscriptions(facets, subscriptions, options);

  logger.info('[SYNAPSE] Matched subscriptions', {
    stateType: change.stateType,
    facetCount: facets.length,
    candidateCount: subscriptions.length,
    matchCount: matches.length,
  });

  return matches;
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

      // What is left of the subscription, so the agent can weigh acting now against
      // spending the last of a limited budget on a marginal match.
      if (subscription.maxTriggerCount !== null) {
        const remaining = Math.max(0, subscription.maxTriggerCount - subscription.triggerCount);
        lines.push(`   Firings left: ${remaining} of ${subscription.maxTriggerCount}`);
      }

      if (subscription.expiresAt) {
        lines.push(`   Expires: ${subscription.expiresAt}`);
      }

      return lines.join('\n');
    })
    .join('\n\n');
}
