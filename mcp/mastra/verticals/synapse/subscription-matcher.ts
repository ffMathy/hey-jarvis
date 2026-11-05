/**
 * Subscription Matching
 *
 * Turns an incoming state change into a shortlist of subscriptions worth showing
 * to the LLM. Matching is purely vector-based — every subscription's `whenEvent` and
 * `givenCondition` components are embedded with Model2Vec (potion), so scoring the whole
 * subscription set against a state change costs a single embedding plus a handful of dot
 * products. The components' embeddings are derived from their text here rather than
 * stored, and kept while the subscription is (see {@link embedSubscriptions}).
 *
 * This is deliberately a *recall* step, not a decision step: it is tuned to be
 * generous, and the reactor agent makes the final call on whether the `thenAction`
 * should actually run.
 */

import { logger } from '../../utils/logger.js';
import { cosineSimilarity, embedTexts } from '../../utils/static-embedder.js';
import { thirdPersonVariant } from './paraphrase.js';
import { describeStateChangeFacets, type StateChange } from './state-change.js';
import { getSubscriptionStore, type Subscription } from './subscription-store.js';

/**
 * A subscription plus the embeddings of its components, as used by the matcher.
 */
export interface EmbeddedSubscription extends Subscription {
  whenEmbedding: Float32Array;
  givenEmbedding: Float32Array | null;
  /**
   * Embedding of a third-person rewrite of `whenEvent`, when it was phrased in the
   * first person. Matching takes the better of this and {@link whenEmbedding}, so a
   * subscription is reachable both from how the user said it and from how a device
   * reports it. Null when the clause contained no first-person pronouns.
   */
  whenAlternateEmbedding: Float32Array | null;
  /** The same, for `givenCondition`. */
  givenAlternateEmbedding: Float32Array | null;
}

/**
 * Every phrasing a live subscription is matched on, embedded, by its text.
 *
 * Matching runs on every state change and the subscriptions hardly ever change, so each phrasing
 * is embedded once rather than on every match. Only the phrasings of the subscriptions last
 * embedded are kept, so it is no bigger than the set being matched against.
 */
const phrasingEmbeddings = new Map<string, Float32Array>();

/**
 * Embeds what subscriptions are matched on: their `whenEvent` and `givenCondition`, each also in the
 * third person when it was phrased in the first.
 *
 * Users say "when I get home from work"; devices report "person is Mathias, state is arrived home",
 * and the static embedder cannot connect the two on its own. Matching takes the better of the two
 * phrasings, so the rewrite can only add reach. The `thenAction` is not embedded: nothing is matched
 * against it, and its text is what the reactor needs.
 *
 * Two state changes can be matched at once, against different sets (one including disabled
 * subscriptions, say), and each drops the other's phrasings from {@link phrasingEmbeddings}. So a
 * call takes what it needs from the store before it waits on the embedder, and answers from its own
 * map, never from the store after the wait.
 */
export async function embedSubscriptions(subscriptions: Subscription[]): Promise<EmbeddedSubscription[]> {
  const phrased = subscriptions.map((subscription) => ({
    subscription,
    when: subscription.whenEvent,
    whenAlternate: thirdPersonVariant(subscription.whenEvent),
    given: subscription.givenCondition ?? null,
    givenAlternate: subscription.givenCondition ? thirdPersonVariant(subscription.givenCondition) : null,
  }));

  const phrasings = new Set(
    phrased.flatMap(({ when, whenAlternate, given, givenAlternate }) =>
      [when, whenAlternate, given, givenAlternate].filter((phrasing) => phrasing !== null),
    ),
  );

  const embedded = new Map<string, Float32Array>();
  const unembedded: string[] = [];
  for (const phrasing of phrasings) {
    const kept = phrasingEmbeddings.get(phrasing);
    if (kept) {
      embedded.set(phrasing, kept);
    } else {
      unembedded.push(phrasing);
    }
  }
  for (const phrasing of phrasingEmbeddings.keys()) {
    if (!phrasings.has(phrasing)) {
      phrasingEmbeddings.delete(phrasing);
    }
  }

  const embeddings = await embedTexts(unembedded);
  unembedded.forEach((phrasing, index) => {
    const embedding = embeddings[index];
    if (embedding) {
      embedded.set(phrasing, embedding);
      phrasingEmbeddings.set(phrasing, embedding);
    }
  });

  const embeddingOf = (phrasing: string): Float32Array => {
    const embedding = embedded.get(phrasing);
    if (!embedding) {
      throw new Error(`The static embedder returned no embedding for "${phrasing}"`);
    }
    return embedding;
  };

  return phrased.map(({ subscription, when, whenAlternate, given, givenAlternate }) => ({
    ...subscription,
    whenEmbedding: embeddingOf(when),
    givenEmbedding: given === null ? null : embeddingOf(given),
    whenAlternateEmbedding: whenAlternate === null ? null : embeddingOf(whenAlternate),
    givenAlternateEmbedding: givenAlternate === null ? null : embeddingOf(givenAlternate),
  }));
}

/** The stored subscriptions, embedded for matching. */
export async function loadEmbeddedSubscriptions(
  options: { includeDisabled?: boolean } = {},
): Promise<EmbeddedSubscription[]> {
  const store = await getSubscriptionStore();
  return embedSubscriptions(await store.list({ includeDisabled: options.includeDisabled ?? false }));
}

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
  const subscriptions = await loadEmbeddedSubscriptions(options);

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
    .map(({ whenEmbedding, givenEmbedding, whenAlternateEmbedding, givenAlternateEmbedding, ...subscription }) => {
      const whenScore = bestSimilarity(facets, [whenEmbedding, whenAlternateEmbedding]);
      const givenScore = givenEmbedding ? bestSimilarity(facets, [givenEmbedding, givenAlternateEmbedding]) : null;

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
  const subscriptions = await loadEmbeddedSubscriptions(options);

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
 * When the state change classifier has already judged the candidates, its answer for each is
 * written under it, as a second opinion to the similarity: similarity says a subscription is on
 * the same topic, and the classifier says whether its WHEN actually happened.
 *
 * @param matches - Matches to render, strongest first
 * @param fireProbabilities - The classifier's probability that each subscription fires, by id
 */
export function formatSubscriptionMatches(
  matches: SubscriptionMatch[],
  fireProbabilities: ReadonlyMap<string, number> = new Map(),
): string {
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

      const fireProbability = fireProbabilities.get(subscription.id);
      if (fireProbability !== undefined) {
        lines.push(`   Classifier: fires with probability ${fireProbability.toFixed(2)}`);
      }

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
