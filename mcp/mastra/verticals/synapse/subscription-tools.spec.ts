/**
 * Subscription tool tests.
 *
 * These exercise the real Model2Vec embedder and a real subscription store, on Jarvis's
 * Knowledge over an in-memory store. No LLM is involved anywhere: the tools themselves never
 * call one — embedding and ranking are the whole mechanism — so the only thing that has to be
 * substituted is the store singleton, which would otherwise write into the process-wide
 * database.
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { InMemoryStore } from '@mastra/core/storage';
import { createJarvisKnowledge } from '../../knowledge/index.js';
import { executeTool } from '../../utils/tool-factory.js';
import * as realSubscriptionStore from './subscription-store.js';
import { SubscriptionStore } from './subscription-store.js';

const store = new SubscriptionStore(createJarvisKnowledge(new InMemoryStore()));

// Both subscription-tools.ts and subscription-matcher.ts reach for the store singleton
// through this module, so one substitution covers the pair. `mock.module` is
// process-global in Bun and replaces the whole module, so the real exports are spread
// back in: other specs sharing this process reach for the rest of it, and a mock
// carrying only the one function turns that into a module-resolution error somewhere
// unrelated.
mock.module('./subscription-store.js', () => ({
  ...realSubscriptionStore,
  getSubscriptionStore: async () => store,
}));

const {
  findRelevantSubscriptions,
  listSubscriptions,
  markSubscriptionTriggered,
  registerSubscription,
  removeSubscription,
  setSubscriptionEnabled,
} = await import('./subscription-tools.js');

/**
 * Registers a subscription through the tool.
 *
 * Every field is passed explicitly: the tool is invoked directly rather than
 * through an agent, so Zod's `.default()` values are never filled in.
 */
async function register(
  whenEvent: string,
  thenAction: string,
  options: {
    givenCondition?: string;
    oneShot?: boolean;
    source?: string;
    maxTriggerCount?: number;
    expiresAt?: string;
  } = {},
) {
  // Every subscription has to declare an end, and a one-shot already implies one.
  // Anything else gets a horizon far enough out that it never expires mid-test:
  // these tests are about registration, matching and removal, not about expiry,
  // which is covered on its own in subscription-expiry.spec.ts.
  const declaresAnEnd = options.oneShot || options.maxTriggerCount !== undefined || options.expiresAt !== undefined;

  const result = await executeTool(registerSubscription, {
    whenEvent,
    thenAction,
    givenCondition: options.givenCondition,
    source: options.source ?? 'user',
    oneShot: options.oneShot ?? false,
    maxTriggerCount: options.maxTriggerCount,
    expiresAt: declaresAnEnd ? options.expiresAt : FAR_FUTURE,
  });

  return result.subscription;
}

/** A horizon no test runs long enough to reach. */
const FAR_FUTURE = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

beforeEach(async () => {
  await store.clear();
});

describe('registerSubscription', () => {
  it('stores all three Given/When/Then components', async () => {
    const subscription = await register('the sun goes down', 'close the blinds', {
      givenCondition: 'the lights are on',
    });

    expect(subscription.id).toBeTruthy();
    expect(subscription.whenEvent).toBe('the sun goes down');
    expect(subscription.givenCondition).toBe('the lights are on');
    expect(subscription.thenAction).toBe('close the blinds');
    expect(subscription.enabled).toBe(true);
    expect(subscription.triggerCount).toBe(0);
    expect(subscription.lastTriggeredAt).toBeNull();
  });

  it('accepts a subscription with no GIVEN component', async () => {
    const subscription = await register('I get home from work', 'turn on the lights');

    expect(subscription.givenCondition).toBeUndefined();
  });

  it('embeds the components so the subscription is immediately findable', async () => {
    await register('the washing machine finishes', 'remind me to hang the laundry');

    const { matches, count } = await executeTool(findRelevantSubscriptions, {
      description: 'the washing machine has finished its cycle',
      minimumScore: 0.3,
      maximumMatches: 5,
    });

    expect(count).toBe(1);
    expect(matches[0].subscription.thenAction).toBe('remind me to hang the laundry');
  });

  it('records which source registered the subscription', async () => {
    const subscription = await register('a sensor battery runs low', 'add batteries to the list', {
      source: 'internet-of-things',
    });

    expect(subscription.source).toBe('internet-of-things');
  });
});

describe('listSubscriptions', () => {
  it('returns an empty list before anything is registered', async () => {
    const result = await executeTool(listSubscriptions, { includeDisabled: false });

    expect(result.subscriptions).toEqual([]);
    expect(result.count).toBe(0);
  });

  it('hides disabled subscriptions unless asked for them', async () => {
    const kept = await register('it starts raining', 'close the windows');
    const paused = await register('the doorbell rings', 'notify me');
    await executeTool(setSubscriptionEnabled, { subscriptionId: paused.id, enabled: false });

    const active = await executeTool(listSubscriptions, { includeDisabled: false });
    const all = await executeTool(listSubscriptions, { includeDisabled: true });

    expect(active.subscriptions.map((s) => s.id)).toEqual([kept.id]);
    expect(all.count).toBe(2);
  });
});

describe('findRelevantSubscriptions', () => {
  it('returns nothing when no subscriptions are registered', async () => {
    const result = await executeTool(findRelevantSubscriptions, {
      description: 'the sun has gone down',
      minimumScore: 0.3,
      maximumMatches: 5,
    });

    expect(result.matches).toEqual([]);
    expect(result.count).toBe(0);
  });

  it('scores against the GIVEN component as well as the WHEN', async () => {
    await register('the sun goes down', 'close the blinds', { givenCondition: 'the lights are on' });

    const { matches } = await executeTool(findRelevantSubscriptions, {
      description: 'internet-of-things device state changed: device is the lights, state is on',
      minimumScore: 0.2,
      maximumMatches: 5,
    });

    expect(matches.length).toBe(1);
    expect(matches[0].givenScore).not.toBeNull();
    // The state change describes the precondition, not the trigger.
    expect(matches[0].givenScore ?? 0).toBeGreaterThan(matches[0].whenScore);
  });

  it('reports a null GIVEN score for subscriptions without one', async () => {
    await register('the milk in the fridge expires', 'add milk to the shopping list');

    const { matches } = await executeTool(findRelevantSubscriptions, {
      description: 'the milk has expired',
      minimumScore: 0.3,
      maximumMatches: 5,
    });

    expect(matches[0].givenScore).toBeNull();
  });

  it('excludes disabled subscriptions from matching', async () => {
    const subscription = await register('the milk in the fridge expires', 'add milk to the shopping list');

    const before = await executeTool(findRelevantSubscriptions, {
      description: 'the milk has expired',
      minimumScore: 0.3,
      maximumMatches: 5,
    });
    expect(before.count).toBe(1);

    await executeTool(setSubscriptionEnabled, { subscriptionId: subscription.id, enabled: false });

    const after = await executeTool(findRelevantSubscriptions, {
      description: 'the milk has expired',
      minimumScore: 0.3,
      maximumMatches: 5,
    });
    expect(after.count).toBe(0);
  });

  it('honours the shortlist cap', async () => {
    await register('it starts raining', 'close the windows');
    await register('it starts to rain outside', 'bring in the washing');
    await register('rain is detected', 'turn off the sprinklers');

    const { matches } = await executeTool(findRelevantSubscriptions, {
      description: 'it has started raining heavily',
      minimumScore: 0.2,
      maximumMatches: 2,
    });

    expect(matches.length).toBe(2);
  });
});

describe('markSubscriptionTriggered', () => {
  it('increments the trigger count and keeps a recurring subscription armed', async () => {
    const subscription = await register('the sun goes down', 'close the blinds');

    const first = await executeTool(markSubscriptionTriggered, { subscriptionId: subscription.id });
    const second = await executeTool(markSubscriptionTriggered, { subscriptionId: subscription.id });

    expect(first.triggered).toBe(true);
    expect(first.stillEnabled).toBe(true);
    expect(second.stillEnabled).toBe(true);

    const { subscriptions } = await executeTool(listSubscriptions, { includeDisabled: false });
    expect(subscriptions[0].triggerCount).toBe(2);
    expect(subscriptions[0].lastTriggeredAt).not.toBeNull();
  });

  it('disables a one-shot subscription after it fires', async () => {
    const subscription = await register('I get home from work', 'turn on the lights', { oneShot: true });

    const result = await executeTool(markSubscriptionTriggered, { subscriptionId: subscription.id });

    expect(result.triggered).toBe(true);
    expect(result.stillEnabled).toBe(false);
    expect(result.message).toContain('one-shot');

    const active = await executeTool(listSubscriptions, { includeDisabled: false });
    expect(active.count).toBe(0);
  });

  it('stops a spent one-shot subscription from matching again', async () => {
    const subscription = await register('the washing machine finishes', 'remind me to hang the laundry', {
      oneShot: true,
    });
    await executeTool(markSubscriptionTriggered, { subscriptionId: subscription.id });

    const { count } = await executeTool(findRelevantSubscriptions, {
      description: 'the washing machine has finished its cycle',
      minimumScore: 0.3,
      maximumMatches: 5,
    });

    expect(count).toBe(0);
  });

  it('reports a missing subscription rather than throwing', async () => {
    const result = await executeTool(markSubscriptionTriggered, { subscriptionId: 'does-not-exist' });

    expect(result.triggered).toBe(false);
    expect(result.message).toContain('does-not-exist');
  });
});

describe('setSubscriptionEnabled', () => {
  it('re-arms a spent one-shot subscription', async () => {
    const subscription = await register('I get home from work', 'turn on the lights', { oneShot: true });
    await executeTool(markSubscriptionTriggered, { subscriptionId: subscription.id });

    const result = await executeTool(setSubscriptionEnabled, { subscriptionId: subscription.id, enabled: true });

    expect(result.updated).toBe(true);
    const active = await executeTool(listSubscriptions, { includeDisabled: false });
    expect(active.count).toBe(1);
  });

  it('reports a missing subscription rather than throwing', async () => {
    const result = await executeTool(setSubscriptionEnabled, { subscriptionId: 'does-not-exist', enabled: false });

    expect(result.updated).toBe(false);
  });
});

describe('removeSubscription', () => {
  it('deletes the subscription for good', async () => {
    const subscription = await register('the doorbell rings', 'notify me');

    const result = await executeTool(removeSubscription, { subscriptionId: subscription.id });

    expect(result.removed).toBe(true);
    const all = await executeTool(listSubscriptions, { includeDisabled: true });
    expect(all.count).toBe(0);
  });

  it('reports a missing subscription rather than throwing', async () => {
    const result = await executeTool(removeSubscription, { subscriptionId: 'does-not-exist' });

    expect(result.removed).toBe(false);
  });
});
