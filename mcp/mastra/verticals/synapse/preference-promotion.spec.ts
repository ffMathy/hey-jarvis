/**
 * Promotion of working-memory preferences to subscriptions.
 *
 * The model that reads WHEN/GIVEN/THEN out of working memory is not involved here: its
 * answer is supplied directly. What is tested is everything decided after it — what is
 * created, renewed and retired — plus the real storage round trip against a temporary
 * SQLite file and the local static embedder, neither of which needs a credential.
 */

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { SubscriptionStorage } from '../../storage/subscriptions.js';
import {
  applyPromotionPlan,
  type ExtractedPreference,
  PROMOTED_SUBSCRIPTION_SOURCE,
  PROMOTION_LEASE_MILLISECONDS,
  type PromotionSubscription,
  planPromotion,
  promotionLeaseExpiry,
  subscriptionKey,
  toPromotionSubscription,
} from './preference-promotion.js';
import { createSubscription } from './subscription-tools.js';

const databaseDirectory = await mkdtemp(path.join(tmpdir(), 'synapse-preference-promotion-'));
const storage = new SubscriptionStorage(path.join(databaseDirectory, 'subscriptions.db'));

// The real clock, because storage judges deadlines against it: a fixed date would make
// every lease here lapse once the calendar passed it.
const now = new Date();
const lease = new Date(now.getTime() + PROMOTION_LEASE_MILLISECONDS).toISOString();

function preference(overrides: Partial<ExtractedPreference> = {}): ExtractedPreference {
  return {
    preference: 'User wants to know about freezing temperatures',
    whenEvent: 'the outdoor temperature drops below freezing',
    givenCondition: null,
    thenAction: 'notify the user',
    existingSubscriptionId: null,
    ...overrides,
  };
}

function subscription(overrides: Partial<PromotionSubscription> = {}): PromotionSubscription {
  return {
    id: 'promoted-1',
    source: PROMOTED_SUBSCRIPTION_SOURCE,
    whenEvent: 'the outdoor temperature drops below freezing',
    thenAction: 'notify the user',
    ...overrides,
  };
}

describe('promotionLeaseExpiry', () => {
  it('is a week after the pass', () => {
    expect(promotionLeaseExpiry(new Date('2026-09-29T12:00:00.000Z'))).toBe('2026-10-06T12:00:00.000Z');
  });
});

describe('subscriptionKey', () => {
  it('ignores case, spacing and trailing punctuation', () => {
    expect(subscriptionKey({ whenEvent: 'The  sun goes down.', thenAction: 'Close the blinds!' })).toBe(
      subscriptionKey({ whenEvent: 'the sun goes down', thenAction: 'close the blinds' }),
    );
  });

  it('treats a missing and a null GIVEN alike, and a present one as different', () => {
    const bare = subscriptionKey({ whenEvent: 'the sun goes down', thenAction: 'close the blinds' });

    expect(
      subscriptionKey({ whenEvent: 'the sun goes down', givenCondition: null, thenAction: 'close the blinds' }),
    ).toBe(bare);
    expect(
      subscriptionKey({
        whenEvent: 'the sun goes down',
        givenCondition: 'the lights are on',
        thenAction: 'close the blinds',
      }),
    ).not.toBe(bare);
  });
});

describe('planPromotion', () => {
  it('creates a subscription for a new preference, leased a week out', () => {
    const plan = planPromotion({ preferences: [preference()], subscriptions: [], now });

    expect(plan.create).toEqual([
      {
        preference: 'User wants to know about freezing temperatures',
        whenEvent: 'the outdoor temperature drops below freezing',
        givenCondition: undefined,
        thenAction: 'notify the user',
        expiresAt: lease,
      },
    ]);
    expect(plan.renew).toEqual([]);
    expect(plan.retire).toEqual([]);
  });

  it('keeps a GIVEN the preference states', () => {
    const plan = planPromotion({
      preferences: [preference({ givenCondition: ' nobody is home ' })],
      subscriptions: [],
      now,
    });

    expect(plan.create[0]?.givenCondition).toBe('nobody is home');
  });

  it('renews rather than duplicates a preference the model points at by id', () => {
    const plan = planPromotion({
      preferences: [preference({ whenEvent: 'it gets below zero outside', existingSubscriptionId: 'promoted-1' })],
      subscriptions: [subscription()],
      now,
    });

    expect(plan.create).toEqual([]);
    expect(plan.renew).toEqual([{ id: 'promoted-1', expiresAt: lease }]);
    expect(plan.retire).toEqual([]);
  });

  it('renews a preference whose wording matches, even without an id', () => {
    const plan = planPromotion({
      preferences: [preference({ whenEvent: 'The outdoor temperature drops below freezing.' })],
      subscriptions: [subscription()],
      now,
    });

    expect(plan.create).toEqual([]);
    expect(plan.renew).toEqual([{ id: 'promoted-1', expiresAt: lease }]);
  });

  it('falls back to creating when the id the model gave does not exist', () => {
    const plan = planPromotion({
      preferences: [preference({ whenEvent: 'mom texts about dinner', existingSubscriptionId: 'made-up' })],
      subscriptions: [subscription()],
      now,
    });

    expect(plan.create.map((promotion) => promotion.whenEvent)).toEqual(['mom texts about dinner']);
    expect(plan.retire).toEqual(['promoted-1']);
  });

  it('retires promoted subscriptions whose preference is gone', () => {
    const plan = planPromotion({
      preferences: [],
      subscriptions: [subscription(), subscription({ id: 'promoted-2', whenEvent: 'mom texts about dinner' })],
      now,
    });

    expect(plan.retire).toEqual(['promoted-1', 'promoted-2']);
    expect(plan.create).toEqual([]);
    expect(plan.renew).toEqual([]);
  });

  it('never renews or retires a subscription the user registered', () => {
    const userSubscription = subscription({ id: 'user-1', source: 'user' });

    const withPreference = planPromotion({ preferences: [preference()], subscriptions: [userSubscription], now });
    const withoutPreference = planPromotion({ preferences: [], subscriptions: [userSubscription], now });

    for (const plan of [withPreference, withoutPreference]) {
      expect(plan.renew).toEqual([]);
      expect(plan.retire).toEqual([]);
      expect(plan.create).toEqual([]);
    }
  });

  it('does not promote a preference a user subscription already covers', () => {
    const byWording = planPromotion({
      preferences: [preference()],
      subscriptions: [subscription({ id: 'user-1', source: 'user' })],
      now,
    });
    const byId = planPromotion({
      preferences: [preference({ whenEvent: 'it freezes', existingSubscriptionId: 'user-1' })],
      subscriptions: [subscription({ id: 'user-1', source: 'user' })],
      now,
    });

    for (const plan of [byWording, byId]) {
      expect(plan.create).toEqual([]);
      expect(plan.skipped).toEqual([
        { preference: 'User wants to know about freezing temperatures', reason: 'covered-by-user-subscription' },
      ]);
    }
  });

  it('collapses a preference the model listed twice', () => {
    const newTwice = planPromotion({ preferences: [preference(), preference()], subscriptions: [], now });
    expect(newTwice.create.length).toBe(1);
    expect(newTwice.skipped.map((skip) => skip.reason)).toEqual(['duplicate']);

    const existingTwice = planPromotion({
      preferences: [preference({ existingSubscriptionId: 'promoted-1' }), preference()],
      subscriptions: [subscription()],
      now,
    });
    expect(existingTwice.renew).toEqual([{ id: 'promoted-1', expiresAt: lease }]);
    expect(existingTwice.create).toEqual([]);
    expect(existingTwice.skipped.map((skip) => skip.reason)).toEqual(['duplicate']);
  });

  it('replaces a promoted subscription whose preference was reworded into something else', () => {
    const plan = planPromotion({
      preferences: [preference({ whenEvent: 'the outdoor temperature drops below 5 degrees' })],
      subscriptions: [subscription()],
      now,
    });

    expect(plan.create.map((promotion) => promotion.whenEvent)).toEqual([
      'the outdoor temperature drops below 5 degrees',
    ]);
    expect(plan.retire).toEqual(['promoted-1']);
  });
});

describe('applyPromotionPlan', () => {
  beforeEach(async () => {
    await storage.clear();
  });

  afterAll(async () => {
    await rm(databaseDirectory, { force: true, recursive: true });
  });

  /** One promotion pass over `preferences`, as the workflow runs it. */
  async function promote(preferences: ExtractedPreference[], at: Date = now) {
    const subscriptions = (await storage.list({ includeDisabled: true })).map(toPromotionSubscription);
    return await applyPromotionPlan(planPromotion({ preferences, subscriptions, now: at }), storage);
  }

  it('stores a promoted subscription as recurring, leased and owned by memory', async () => {
    const outcome = await promote([preference()]);
    expect(outcome).toEqual({ created: 1, renewed: 0, retired: 0, skipped: 0 });

    const [stored] = await storage.list({ includeDisabled: true });
    expect(stored?.source).toBe(PROMOTED_SUBSCRIPTION_SOURCE);
    expect(stored?.oneShot).toBe(false);
    expect(stored?.maxTriggerCount).toBeNull();
    expect(stored?.expiresAt).toBe(lease);
  });

  it('is idempotent: a second pass over the same memory renews instead of duplicating', async () => {
    await promote([preference()]);
    const later = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const outcome = await promote([preference()], later);

    expect(outcome).toEqual({ created: 0, renewed: 1, retired: 0, skipped: 0 });

    const all = await storage.list({ includeDisabled: true });
    expect(all.length).toBe(1);
    expect(all[0]?.expiresAt).toBe(promotionLeaseExpiry(later));
  });

  it('keeps a paused promoted subscription paused, and its firings, when renewing it', async () => {
    await promote([preference()]);
    const [stored] = await storage.list();
    if (!stored) throw new Error('expected a promoted subscription');

    await storage.markTriggered(stored.id);
    await storage.setEnabled(stored.id, false);
    await promote([preference({ existingSubscriptionId: stored.id })]);

    const renewed = await storage.get(stored.id);
    expect(renewed?.enabled).toBe(false);
    expect(renewed?.triggerCount).toBe(1);
  });

  it('deletes a promoted subscription once its preference leaves memory, and leaves the user’s alone', async () => {
    const userSubscription = await createSubscription(storage, {
      source: 'user',
      whenEvent: 'the doorbell rings',
      thenAction: 'notify the user',
      expiresAt: lease,
    });
    await promote([preference()]);

    const outcome = await promote([]);
    expect(outcome).toEqual({ created: 0, renewed: 0, retired: 1, skipped: 0 });

    const remaining = await storage.list({ includeDisabled: true });
    expect(remaining.map((stored) => stored.id)).toEqual([userSubscription.id]);
  });
});
