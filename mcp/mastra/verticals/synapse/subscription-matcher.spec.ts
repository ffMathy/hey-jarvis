import { describe, expect, it } from 'bun:test';
import type { EmbeddedSubscription } from '../../storage/subscriptions.js';
import { embedText } from '../../utils/static-embedder.js';
import { describeStateChange } from './state-change.js';
import { DEFAULT_MINIMUM_SCORE, formatSubscriptionMatches, rankSubscriptions } from './subscription-matcher.js';

interface SubscriptionDraft {
  whenEvent: string;
  givenCondition?: string;
  thenAction: string;
  oneShot?: boolean;
}

async function embedSubscription(draft: SubscriptionDraft, index: number): Promise<EmbeddedSubscription> {
  return {
    id: `subscription-${index}`,
    source: 'user',
    whenEvent: draft.whenEvent,
    givenCondition: draft.givenCondition,
    thenAction: draft.thenAction,
    oneShot: draft.oneShot ?? false,
    enabled: true,
    createdAt: new Date().toISOString(),
    lastTriggeredAt: null,
    triggerCount: 0,
    // Ranking never looks at how a subscription ends, so these fixtures leave it open.
    maxTriggerCount: null,
    expiresAt: null,
    whenEmbedding: await embedText(draft.whenEvent),
    givenEmbedding: draft.givenCondition ? await embedText(draft.givenCondition) : null,
  };
}

// The two examples from the Synapse design, plus a decoy that shares no vocabulary.
const DRAFTS: SubscriptionDraft[] = [
  { whenEvent: 'the sun goes down', givenCondition: 'the lights are on', thenAction: 'close the blinds' },
  { whenEvent: 'I get home from work', thenAction: 'turn on the lights', oneShot: true },
  { whenEvent: 'the milk in the fridge expires', thenAction: 'add milk to the shopping list' },
];

const subscriptions = await Promise.all(DRAFTS.map(embedSubscription));

describe('rankSubscriptions', () => {
  it('matches a state change against the WHEN component', async () => {
    const description = describeStateChange({
      source: 'weather',
      stateType: 'sun_position_changed',
      stateData: { event: 'the sun has gone down' },
    });

    const matches = rankSubscriptions(await embedText(description), subscriptions);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].subscription.whenEvent).toBe('the sun goes down');
    expect(matches[0].whenScore).toBeGreaterThan(matches[0].givenScore ?? 0);
  });

  it('matches a state change against the GIVEN component', async () => {
    const description = describeStateChange({
      source: 'internet-of-things',
      stateType: 'device_state_changed',
      stateData: { device: 'the lights', state: 'on' },
    });

    const matches = rankSubscriptions(await embedText(description), subscriptions, { minimumScore: 0.2 });

    const blinds = matches.find((match) => match.subscription.thenAction === 'close the blinds');
    expect(blinds).toBeDefined();
    expect(blinds?.givenScore).not.toBeNull();
    expect(blinds?.givenScore ?? 0).toBeGreaterThan(blinds?.whenScore ?? 1);
  });

  it('ranks by the stronger of the WHEN and GIVEN scores', async () => {
    const matches = rankSubscriptions(await embedText('I just arrived home from the office'), subscriptions);

    expect(matches[0].subscription.thenAction).toBe('turn on the lights');
    expect(matches[0].score).toBe(Math.max(matches[0].whenScore, matches[0].givenScore ?? Number.NEGATIVE_INFINITY));
  });

  it('reports no GIVEN score for subscriptions without one', async () => {
    const matches = rankSubscriptions(await embedText('I just arrived home from the office'), subscriptions);

    expect(matches[0].subscription.givenCondition).toBeUndefined();
    expect(matches[0].givenScore).toBeNull();
  });

  it('returns nothing when the state change is unrelated to every subscription', async () => {
    const description = describeStateChange({
      source: 'coding',
      stateType: 'pull_request_opened',
      stateData: { repository: 'hey-jarvis', title: 'Refactor the deployment script' },
    });

    expect(rankSubscriptions(await embedText(description), subscriptions)).toEqual([]);
  });

  it('honours the score floor', async () => {
    const embedding = await embedText('the sun has gone down');

    const strict = rankSubscriptions(embedding, subscriptions, { minimumScore: 0.99 });
    const loose = rankSubscriptions(embedding, subscriptions, { minimumScore: -1 });

    expect(strict).toEqual([]);
    expect(loose.length).toBe(subscriptions.length);
  });

  it('caps the shortlist size', async () => {
    const matches = rankSubscriptions(await embedText('the sun has gone down'), subscriptions, {
      minimumScore: -1,
      maximumMatches: 1,
    });

    expect(matches.length).toBe(1);
  });

  it('sorts matches strongest first', async () => {
    const matches = rankSubscriptions(await embedText('the sun has gone down'), subscriptions, { minimumScore: -1 });
    const scores = matches.map((match) => match.score);

    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('uses a score floor that separates the design examples', async () => {
    const sunset = rankSubscriptions(await embedText('the sun has gone down'), subscriptions);
    const home = rankSubscriptions(await embedText('I just arrived home from the office'), subscriptions);

    // Each example retrieves its own subscription and not the other's.
    expect(sunset.map((match) => match.subscription.id)).toEqual(['subscription-0']);
    expect(home.map((match) => match.subscription.id)).toEqual(['subscription-1']);
    expect(DEFAULT_MINIMUM_SCORE).toBeGreaterThan(0);
  });
});

describe('formatSubscriptionMatches', () => {
  it('explains that nothing matched when the shortlist is empty', () => {
    expect(formatSubscriptionMatches([])).toBe('No subscriptions matched this state change.');
  });

  it('includes all three components plus the similarity scores', async () => {
    const matches = rankSubscriptions(await embedText('the sun has gone down'), subscriptions);
    const formatted = formatSubscriptionMatches(matches);

    expect(formatted).toContain('WHEN: the sun goes down');
    expect(formatted).toContain('GIVEN: the lights are on');
    expect(formatted).toContain('THEN: close the blinds');
    expect(formatted).toContain('similarity');
  });

  it('omits the GIVEN line for subscriptions without one, and flags one-shots', async () => {
    const matches = rankSubscriptions(await embedText('I just arrived home from the office'), subscriptions);
    const formatted = formatSubscriptionMatches(matches);

    expect(formatted).not.toContain('GIVEN:');
    expect(formatted).toContain('(one-shot)');
    expect(formatted).toContain('THEN: turn on the lights');
  });
});
