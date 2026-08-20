/**
 * Every subscription has to declare how it ends.
 *
 * Registration refuses one that does not, which is the part worth testing directly:
 * the check runs before storage is touched, so these need no database and no model.
 * The behaviour that follows from the fields — spending a budget, hiding a lapsed
 * subscription, deleting it — is covered against a real database in
 * `storage/subscriptions.spec.ts`.
 */

import { describe, expect, it } from 'bun:test';
import type { Subscription } from '../../storage/subscriptions.js';
import { executeTool } from '../../utils/tool-factory.js';
import { formatSubscriptionMatches, type SubscriptionMatch } from './subscription-matcher.js';
import { registerSubscription, removeSubscription } from './subscription-tools.js';

const BASE = {
  whenEvent: 'the sun goes down',
  thenAction: 'close the blinds',
  source: 'synapse-expiry-spec',
  oneShot: false,
};

describe('registerSubscription refusing an endless subscription', () => {
  it('rejects a subscription with neither a budget nor a deadline', async () => {
    // The cost of forgetting is invisible and cumulative — an endless subscription is
    // scored against every state change forever and nothing ever removes it — so this
    // fails loudly rather than quietly accepting one.
    await expect(executeTool(registerSubscription, { ...BASE })).rejects.toThrow(/needs an end/);
  });

  it('explains both ways of supplying one, so the model can retry', async () => {
    await expect(executeTool(registerSubscription, { ...BASE })).rejects.toThrow(/maxTriggerCount/);
    await expect(executeTool(registerSubscription, { ...BASE })).rejects.toThrow(/expiresAt/);
  });

  it('accepts oneShot, which supplies the budget implicitly', async () => {
    // oneShot means "fire once", which is an end. Demanding maxTriggerCount as well
    // would be asking the model to say the same thing twice.
    const result = await executeTool(registerSubscription, { ...BASE, oneShot: true });

    try {
      expect(result.registered).toBe(true);
      expect(result.subscription.maxTriggerCount).toBe(1);
    } finally {
      await executeTool(removeSubscription, { subscriptionId: result.subscription.id });
    }
  });

  it('accepts a deadline on its own', async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const result = await executeTool(registerSubscription, { ...BASE, expiresAt });

    try {
      expect(result.subscription.expiresAt).toBe(expiresAt);
      expect(result.subscription.maxTriggerCount).toBeNull();
    } finally {
      await executeTool(removeSubscription, { subscriptionId: result.subscription.id });
    }
  });

  it('accepts a budget on its own, and keeps both when given both', async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const result = await executeTool(registerSubscription, { ...BASE, maxTriggerCount: 5, expiresAt });

    try {
      // Whichever comes first ends the subscription.
      expect(result.subscription.maxTriggerCount).toBe(5);
      expect(result.subscription.expiresAt).toBe(expiresAt);
    } finally {
      await executeTool(removeSubscription, { subscriptionId: result.subscription.id });
    }
  });
});

describe('showing the agent what is left of a subscription', () => {
  function match(overrides: Partial<Subscription>): SubscriptionMatch {
    const subscription: Subscription = {
      id: 'subscription-1',
      source: 'user',
      whenEvent: 'the sun goes down',
      thenAction: 'close the blinds',
      oneShot: false,
      enabled: true,
      createdAt: new Date().toISOString(),
      lastTriggeredAt: null,
      triggerCount: 0,
      maxTriggerCount: null,
      expiresAt: null,
      ...overrides,
    };

    return { subscription, whenScore: 0.62, givenScore: null, score: 0.62 };
  }

  it('reports how many firings remain', () => {
    const formatted = formatSubscriptionMatches([match({ maxTriggerCount: 3, triggerCount: 1 })]);

    // The agent can then weigh acting now against spending the last of a small budget
    // on a marginal match.
    expect(formatted).toContain('Firings left: 2 of 3');
  });

  it('never reports a negative number of firings', () => {
    // A subscription is pruned once spent, but it can be formatted in the window
    // between firing and pruning.
    const formatted = formatSubscriptionMatches([match({ maxTriggerCount: 1, triggerCount: 4 })]);

    expect(formatted).toContain('Firings left: 0 of 1');
  });

  it('reports the deadline', () => {
    const expiresAt = '2026-09-01T00:00:00.000Z';
    const formatted = formatSubscriptionMatches([match({ expiresAt })]);

    expect(formatted).toContain(`Expires: ${expiresAt}`);
  });

  it('says nothing about limits a subscription does not have', () => {
    const formatted = formatSubscriptionMatches([match({})]);

    expect(formatted).not.toContain('Firings left');
    expect(formatted).not.toContain('Expires');
  });
});
