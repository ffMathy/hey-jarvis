import { z } from 'zod';
import type { Subscription, SubscriptionStorage } from '../../storage/subscriptions.js';
import { logger } from '../../utils/logger.js';
import { createSubscription } from './subscription-tools.js';

/**
 * Promoting working-memory preferences to subscriptions.
 *
 * The State Change Reactor keeps what it learns about the user in Mastra working memory
 * — "wants to know about freezing temperatures", "tell me when mom texts about dinner".
 * That is free text in the reactor's prompt: it may or may not connect a state change to
 * it, and nothing retrieves it by meaning. Subscriptions are the part of the system that
 * does, because every state change is vector-matched against them before the reactor
 * even sees it. Promotion turns the first into the second.
 *
 * Everything in this file is deterministic. The model's only job (see
 * `preference-extraction.ts`) is reading free text into WHEN/GIVEN/THEN; deciding what
 * to create, keep and remove is done here, so it can be tested without one and so a
 * model that misbehaves can never touch a subscription the user registered themselves.
 */

/**
 * The `source` every promoted subscription carries.
 *
 * It is the whole ownership model: the promotion pass only ever renews or deletes rows
 * with this source, and treats every other row as the user's, to be deduplicated
 * against but never changed.
 */
export const PROMOTED_SUBSCRIPTION_SOURCE = 'memory';

/**
 * How far out a promoted subscription's deadline is set, and pushed again on every pass
 * that still finds its preference.
 *
 * A standing preference has no natural end, but `registerSubscription`'s rule that every
 * subscription must say how it ends is there for a reason, so a promoted one gets a
 * lease instead of forever. The promotion pass runs every few hours, so a week is many
 * missed passes of slack — an Ollama outage or a bad deploy does not drop anything — and
 * yet if promotion stops running altogether, every promoted subscription still lapses on
 * its own within a week rather than lingering for the life of the database.
 *
 * A preference that disappears from working memory does not wait for the lease: the next
 * pass deletes its subscription outright.
 */
export const PROMOTION_LEASE_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;

/** The deadline a promoted subscription is given, or renewed to, at `now`. */
export function promotionLeaseExpiry(now: Date): string {
  return new Date(now.getTime() + PROMOTION_LEASE_MILLISECONDS).toISOString();
}

/**
 * One preference as the extraction model reports it.
 *
 * `givenCondition` and `existingSubscriptionId` are nullable rather than optional so the
 * JSON schema asks for every key: small local models honour "always present, maybe null"
 * far more reliably than "sometimes absent".
 */
export const extractedPreferenceSchema = z.object({
  preference: z
    .string()
    .describe('The working-memory text this preference was read from, quoted as closely as possible'),
  whenEvent: z
    .string()
    .describe(
      'The triggering event, as a short clause without the word "when" (e.g. "the temperature drops below freezing")',
    ),
  givenCondition: z
    .string()
    .nullable()
    .describe('A precondition that must hold for the action to apply, or null when the preference states none'),
  thenAction: z.string().describe('What to do when it happens (e.g. "notify the user")'),
  existingSubscriptionId: z
    .string()
    .nullable()
    .describe('The id of a listed subscription that already expresses this preference, or null when none does'),
});

export type ExtractedPreference = z.infer<typeof extractedPreferenceSchema>;

export const extractedPreferencesSchema = z.object({
  preferences: z.array(extractedPreferenceSchema).describe('Every preference found; empty when there are none'),
});

/** The part of a stored subscription the promotion pass needs to see. */
export const promotionSubscriptionSchema = z.object({
  id: z.string(),
  source: z.string(),
  whenEvent: z.string(),
  givenCondition: z.string().optional(),
  thenAction: z.string(),
});

export type PromotionSubscription = z.infer<typeof promotionSubscriptionSchema>;

/** Narrows a stored subscription to what the promotion pass needs. */
export function toPromotionSubscription(subscription: Subscription): PromotionSubscription {
  return {
    id: subscription.id,
    source: subscription.source,
    whenEvent: subscription.whenEvent,
    givenCondition: subscription.givenCondition,
    thenAction: subscription.thenAction,
  };
}

/**
 * Text normalised for comparison: lower case, single spaces, no trailing punctuation.
 *
 * Deliberately shallow. It exists so that "The temperature drops below freezing." and
 * "the temperature drops below freezing" are one subscription, not to judge whether two
 * differently worded clauses mean the same thing — that is the extraction model's call,
 * made by pointing at an existing subscription's id.
 */
function normalize(text: string | null | undefined): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s.!?,;:]+$/, '')
    .trim();
}

/** The identity two subscriptions share when their WHEN, GIVEN and THEN say the same. */
export function subscriptionKey(components: {
  whenEvent: string;
  givenCondition?: string | null;
  thenAction: string;
}): string {
  return [components.whenEvent, components.givenCondition, components.thenAction].map(normalize).join(' | ');
}

/** A promoted subscription that does not exist yet. */
export interface PlannedPromotion {
  preference: string;
  whenEvent: string;
  givenCondition?: string;
  thenAction: string;
  expiresAt: string;
}

/** Why an extracted preference produced no change. */
export type SkipReason = 'covered-by-user-subscription' | 'duplicate';

export interface PromotionPlan {
  /** Preferences that have no subscription yet. */
  create: PlannedPromotion[];
  /** Promoted subscriptions whose preference still stands, with their new deadline. */
  renew: Array<{ id: string; expiresAt: string }>;
  /** Promoted subscriptions whose preference is gone from working memory. */
  retire: string[];
  /** Preferences that were deliberately left alone, and why. */
  skipped: Array<{ preference: string; reason: SkipReason }>;
}

/** What an extracted preference corresponds to among the stored subscriptions. */
type PreferenceMatch = { kind: 'user-owned' } | { kind: 'promoted'; id: string } | { kind: 'new'; key: string };

/**
 * Builds the lookup that says which stored subscription, if any, a preference is.
 *
 * A subscription the user registered wins over a promoted one, so a preference the user
 * has already subscribed to by hand is never promoted alongside it. Among promoted ones,
 * the id the model pointed at is tried before the wording. An id it made up, or one
 * belonging to a row that has since gone, is simply no match.
 */
function createPreferenceMatcher(subscriptions: PromotionSubscription[]) {
  const userOwnedIds = new Set<string>();
  const userOwnedKeys = new Set<string>();
  const promotedIds = new Set<string>();
  const promotedIdsByKey = new Map<string, string>();

  for (const subscription of subscriptions) {
    if (subscription.source === PROMOTED_SUBSCRIPTION_SOURCE) {
      promotedIds.add(subscription.id);
      promotedIdsByKey.set(subscriptionKey(subscription), subscription.id);
    } else {
      userOwnedIds.add(subscription.id);
      userOwnedKeys.add(subscriptionKey(subscription));
    }
  }

  return (preference: ExtractedPreference): PreferenceMatch => {
    const key = subscriptionKey(preference);
    const pointedAt = preference.existingSubscriptionId;

    if ((pointedAt !== null && userOwnedIds.has(pointedAt)) || userOwnedKeys.has(key)) {
      return { kind: 'user-owned' };
    }

    const promotedId = pointedAt !== null && promotedIds.has(pointedAt) ? pointedAt : promotedIdsByKey.get(key);
    return promotedId ? { kind: 'promoted', id: promotedId } : { kind: 'new', key };
  };
}

/**
 * Decides what one promotion pass changes.
 *
 * Idempotent by construction: a preference is matched to an existing promoted
 * subscription first by the id the model pointed at and then by its normalised wording,
 * and only a preference that matches neither is created. Running the pass twice over the
 * same working memory therefore renews on the second run what it created on the first.
 *
 * Subscriptions whose source is not {@link PROMOTED_SUBSCRIPTION_SOURCE} are the user's.
 * They appear here only so a preference they already cover is not promoted a second
 * time; nothing in the plan ever renews or retires one.
 */
export function planPromotion({
  preferences,
  subscriptions,
  now,
}: {
  preferences: ExtractedPreference[];
  subscriptions: PromotionSubscription[];
  now: Date;
}): PromotionPlan {
  const expiresAt = promotionLeaseExpiry(now);
  const matchPreference = createPreferenceMatcher(subscriptions);

  const plan: PromotionPlan = { create: [], renew: [], retire: [], skipped: [] };
  const keptIds = new Set<string>();
  const plannedKeys = new Set<string>();

  for (const preference of preferences) {
    const match = matchPreference(preference);

    if (match.kind === 'user-owned') {
      plan.skipped.push({ preference: preference.preference, reason: 'covered-by-user-subscription' });
    } else if (match.kind === 'promoted' ? keptIds.has(match.id) : plannedKeys.has(match.key)) {
      plan.skipped.push({ preference: preference.preference, reason: 'duplicate' });
    } else if (match.kind === 'promoted') {
      keptIds.add(match.id);
      plan.renew.push({ id: match.id, expiresAt });
    } else {
      plannedKeys.add(match.key);
      plan.create.push({
        preference: preference.preference,
        whenEvent: preference.whenEvent.trim(),
        givenCondition: preference.givenCondition?.trim() || undefined,
        thenAction: preference.thenAction.trim(),
        expiresAt,
      });
    }
  }

  plan.retire = subscriptions
    .filter((subscription) => subscription.source === PROMOTED_SUBSCRIPTION_SOURCE && !keptIds.has(subscription.id))
    .map((subscription) => subscription.id);

  return plan;
}

/** What applying a plan changed, for the workflow's output and the log. */
export interface PromotionOutcome {
  created: number;
  renewed: number;
  retired: number;
  skipped: number;
}

/**
 * Carries out a {@link PromotionPlan} against subscription storage.
 *
 * Renewal only moves the deadline, so a promoted subscription the user paused with
 * `setSubscriptionEnabled` stays paused and keeps its firing count. Retirement deletes
 * rather than disables: the preference is gone from working memory, and a pause is
 * something a user might undo, which this is not.
 */
export async function applyPromotionPlan(plan: PromotionPlan, storage: SubscriptionStorage): Promise<PromotionOutcome> {
  for (const renewal of plan.renew) {
    await storage.setExpiresAt(renewal.id, renewal.expiresAt);
  }

  for (const id of plan.retire) {
    await storage.remove(id);
  }

  for (const promotion of plan.create) {
    await createSubscription(storage, {
      source: PROMOTED_SUBSCRIPTION_SOURCE,
      whenEvent: promotion.whenEvent,
      givenCondition: promotion.givenCondition,
      thenAction: promotion.thenAction,
      // Recurring: a standing preference fires every time, and ends by lease or by
      // leaving working memory, never by running out of firings.
      oneShot: false,
      maxTriggerCount: null,
      expiresAt: promotion.expiresAt,
    });
  }

  const outcome = {
    created: plan.create.length,
    renewed: plan.renew.length,
    retired: plan.retire.length,
    skipped: plan.skipped.length,
  };

  logger.info('Promoted working-memory preferences to subscriptions', {
    ...outcome,
    createdPreferences: plan.create.map((promotion) => promotion.preference),
    retiredIds: plan.retire,
  });

  return outcome;
}
