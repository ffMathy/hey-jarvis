/**
 * Subscription retrieval quality.
 *
 * The rest of the synapse tests check that the matcher does what it says. These
 * check whether what it says is *good enough to be worth doing* — that a realistic
 * set of subscriptions, matched against realistic state changes, actually surfaces
 * the right one often enough for the reactor agent to be useful.
 *
 * No LLM is mocked here because none is involved: retrieval is entirely embedding
 * plus dot product. The embedder is the real Model2Vec (potion) one, so these
 * numbers are the real numbers.
 *
 * Two properties of that embedder shape everything below. It is a static
 * token->vector table combined by mean-pooling, so it has no contextual
 * understanding, and every token that carries no shared meaning pulls the average
 * away from the tokens that do. Retrieval therefore behaves much closer to
 * "weighted vocabulary overlap" than to sentence understanding.
 */

import { describe, expect, it } from 'bun:test';
import type { EmbeddedSubscription } from '../../storage/subscriptions.js';
import { cosineSimilarity, embedText, embedTexts } from '../../utils/static-embedder.js';
import { describeStateChange, type StateChange } from './state-change.js';
import { DEFAULT_MINIMUM_SCORE, rankSubscriptions } from './subscription-matcher.js';

interface Draft {
  id: string;
  whenEvent: string;
  givenCondition?: string;
  thenAction: string;
}

/** A household's worth of subscriptions, spread across the verticals that report state. */
const DRAFTS: Draft[] = [
  { id: 'sunset', whenEvent: 'the sun goes down', givenCondition: 'the lights are on', thenAction: 'close the blinds' },
  { id: 'home', whenEvent: 'I get home from work', thenAction: 'turn on the lights' },
  { id: 'milk', whenEvent: 'the milk in the fridge expires', thenAction: 'add milk to the shopping list' },
  {
    id: 'rain',
    whenEvent: 'it starts raining',
    givenCondition: 'a window is open',
    thenAction: 'remind me to close the windows',
  },
  { id: 'frost', whenEvent: 'the temperature drops below zero', thenAction: 'warn me about frost on the car' },
  {
    id: 'doorbell',
    whenEvent: 'someone rings the doorbell',
    givenCondition: 'nobody is home',
    thenAction: 'send me a notification',
  },
  { id: 'laundry', whenEvent: 'the washing machine finishes', thenAction: 'remind me to hang the laundry' },
  { id: 'boss', whenEvent: 'I receive an email from my boss', thenAction: 'notify me immediately' },
  { id: 'meeting', whenEvent: 'a calendar meeting is about to start', thenAction: 'mute the speakers' },
  {
    id: 'commute',
    whenEvent: 'there is heavy traffic on my route',
    givenCondition: 'it is a weekday morning',
    thenAction: 'suggest leaving earlier',
  },
  { id: 'battery', whenEvent: 'a sensor battery runs low', thenAction: 'add batteries to the shopping list' },
  {
    id: 'garage',
    whenEvent: 'the garage door stays open',
    givenCondition: 'it is night',
    thenAction: 'close the garage door',
  },
  { id: 'co2', whenEvent: 'the air quality gets bad', thenAction: 'turn on the ventilation' },
  { id: 'guest', whenEvent: 'a guest connects to the wifi', thenAction: 'log it' },
  {
    id: 'bedtime',
    whenEvent: 'it is past midnight',
    givenCondition: 'the TV is still on',
    thenAction: 'turn off the TV',
  },
];

/**
 * State changes as the verticals actually emit them — machine-shaped payloads,
 * not sentences a person would type — each labelled with the subscription it
 * ought to retrieve.
 */
const PROBES: Array<{ name: string; change: StateChange; expected: string }> = [
  {
    name: 'sunset',
    expected: 'sunset',
    change: { source: 'weather', stateType: 'sun_position_changed', stateData: { event: 'sunset', elevation: -0.5 } },
  },
  {
    name: 'sunset (worded)',
    expected: 'sunset',
    change: {
      source: 'weather',
      stateType: 'sun_position_changed',
      stateData: { event: 'the sun has set', darkness: true },
    },
  },
  {
    name: 'arrival (presence)',
    expected: 'home',
    change: {
      source: 'internet-of-things',
      stateType: 'presence_changed',
      stateData: { person: 'Mathias', state: 'arrived home' },
    },
  },
  {
    name: 'arrival (tracker)',
    expected: 'home',
    change: {
      source: 'internet-of-things',
      stateType: 'device_tracker',
      stateData: { person: 'Mathias', from: 'work', to: 'home' },
    },
  },
  {
    name: 'milk',
    expected: 'milk',
    change: {
      source: 'shopping',
      stateType: 'item_expiring',
      stateData: { item: 'milk', location: 'fridge', days_left: 0 },
    },
  },
  {
    name: 'rain',
    expected: 'rain',
    change: { source: 'weather', stateType: 'precipitation_started', stateData: { type: 'rain', intensity: 'heavy' } },
  },
  {
    name: 'frost',
    expected: 'frost',
    change: { source: 'weather', stateType: 'temperature_changed', stateData: { temperature: -3, unit: 'celsius' } },
  },
  {
    name: 'doorbell',
    expected: 'doorbell',
    change: { source: 'internet-of-things', stateType: 'doorbell_pressed', stateData: { device: 'front door bell' } },
  },
  {
    name: 'laundry',
    expected: 'laundry',
    change: {
      source: 'internet-of-things',
      stateType: 'appliance_finished',
      stateData: { appliance: 'washing machine', cycle: 'complete' },
    },
  },
  {
    name: 'boss email',
    expected: 'boss',
    change: {
      source: 'email',
      stateType: 'email_received',
      stateData: { from: 'my boss', subject: 'Urgent: budget review' },
    },
  },
  {
    name: 'meeting',
    expected: 'meeting',
    change: {
      source: 'calendar',
      stateType: 'event_starting',
      stateData: { title: 'Sprint planning meeting', starts_in_minutes: 5 },
    },
  },
  {
    name: 'traffic',
    expected: 'commute',
    change: {
      source: 'commute',
      stateType: 'traffic_changed',
      stateData: { route: 'to work', condition: 'heavy traffic', delay_minutes: 25 },
    },
  },
  {
    name: 'battery',
    expected: 'battery',
    change: {
      source: 'internet-of-things',
      stateType: 'battery_low',
      stateData: { device: 'kitchen sensor', battery_level: 8 },
    },
  },
  {
    name: 'garage',
    expected: 'garage',
    change: {
      source: 'internet-of-things',
      stateType: 'cover_state',
      stateData: { device: 'garage door', state: 'open', duration_minutes: 90 },
    },
  },
  {
    name: 'air quality',
    expected: 'co2',
    change: {
      source: 'internet-of-things',
      stateType: 'air_quality_changed',
      stateData: { co2_ppm: 1400, quality: 'poor' },
    },
  },
  {
    name: 'late TV',
    expected: 'bedtime',
    change: {
      source: 'internet-of-things',
      stateType: 'media_player_state',
      stateData: { device: 'living room TV', state: 'playing', time: '00:47' },
    },
  },
];

/** Probes the first-person phrasing gap is known to lose. See the dedicated section below. */
const KNOWN_MISSES = new Set(['arrival (presence)', 'arrival (tracker)']);

async function embedDraft(draft: Draft): Promise<EmbeddedSubscription> {
  return {
    ...draft,
    source: 'user',
    oneShot: false,
    enabled: true,
    createdAt: new Date().toISOString(),
    lastTriggeredAt: null,
    triggerCount: 0,
    whenEmbedding: await embedText(draft.whenEvent),
    givenEmbedding: draft.givenCondition ? await embedText(draft.givenCondition) : null,
  };
}

const subscriptions = await Promise.all(DRAFTS.map(embedDraft));

async function retrieve(change: StateChange, minimumScore = DEFAULT_MINIMUM_SCORE) {
  const embedding = await embedText(describeStateChange(change));
  return rankSubscriptions(embedding, subscriptions, { minimumScore, maximumMatches: 5 });
}

describe('retrieval quality on a realistic corpus', () => {
  it('retrieves the intended subscription for at least 80% of state changes', async () => {
    const hits = await Promise.all(
      PROBES.map(async ({ change, expected }) =>
        (await retrieve(change)).some((match) => match.subscription.id === expected),
      ),
    );

    const recall = hits.filter(Boolean).length / PROBES.length;

    // Measured at 0.88 (14/16). The floor leaves room for embedder updates without
    // being so loose that a real regression slips through.
    expect(recall).toBeGreaterThanOrEqual(0.8);
  });

  it('ranks the intended subscription first whenever it retrieves it at all', async () => {
    for (const { name, change, expected } of PROBES) {
      const matches = await retrieve(change);
      const rank = matches.findIndex((match) => match.subscription.id === expected);

      if (rank === -1) {
        // Only the documented gap is allowed to miss outright.
        expect(KNOWN_MISSES.has(name)).toBe(true);
        continue;
      }

      // Never merely present-but-buried: when the signal is there it wins outright,
      // which is why a shortlist of five costs nothing in practice.
      expect(rank).toBe(0);
    }
  });

  it('keeps the shortlist short enough to be worth putting in a prompt', async () => {
    const counts = await Promise.all(PROBES.map(async ({ change }) => (await retrieve(change)).length));
    const average = counts.reduce((total, count) => total + count, 0) / counts.length;

    // Measured at 1.3 candidates per change. The value of the step is that the LLM
    // sees one or two plausible rules instead of the entire subscription set.
    expect(average).toBeLessThan(3);
    expect(Math.max(...counts)).toBeLessThanOrEqual(5);
  });

  it('returns nothing at all for state changes no subscription cares about', async () => {
    const unrelated: StateChange[] = [
      {
        source: 'coding',
        stateType: 'pull_request_opened',
        stateData: { repository: 'hey-jarvis', title: 'Refactor the deployment script' },
      },
      { source: 'api', stateType: 'token_usage_recorded', stateData: { model: 'gemini', tokens: 12045 } },
    ];

    for (const change of unrelated) {
      expect(await retrieve(change)).toEqual([]);
    }
  });
});

describe('the default score floor', () => {
  it('trades recall for precision in the expected direction', async () => {
    const measure = async (threshold: number) => {
      const results = await Promise.all(
        PROBES.map(async ({ change, expected }) => {
          const matches = await retrieve(change, threshold);
          return {
            hit: matches.some((match) => match.subscription.id === expected),
            returned: matches.length,
          };
        }),
      );

      return {
        recall: results.filter((result) => result.hit).length / results.length,
        candidates: results.reduce((total, result) => total + result.returned, 0) / results.length,
      };
    };

    const loose = await measure(0.2);
    const strict = await measure(0.4);

    // Loosening finds more and shows more; tightening does the reverse. Measured:
    // 0.20 -> 94% recall at 2.9 candidates, 0.40 -> 69% recall at 0.8 candidates.
    expect(loose.recall).toBeGreaterThanOrEqual(strict.recall);
    expect(loose.candidates).toBeGreaterThan(strict.candidates);

    // The default sits where recall is still high. A floor at the strict end of this
    // range would be losing roughly a third of real matches.
    expect(DEFAULT_MINIMUM_SCORE).toBeLessThan(0.4);
  });
});

describe('first-person subscriptions versus machine-shaped state changes', () => {
  /**
   * The known gap, pinned deliberately.
   *
   * "I get home from work" is one of the two worked examples in the Synapse design,
   * and it is exactly how a person phrases a request out loud. But no vertical emits
   * a first-person sentence — Home Assistant reports `person is Mathias, state is
   * arrived home`. The two share almost no vocabulary, and a static mean-pooled
   * embedder has no way to connect them.
   *
   * If a future change makes this pass, that is an improvement and this test should
   * be updated to demand it. It fails loudly rather than silently getting better.
   */
  it('does not connect a first-person WHEN to a third-person state change', async () => {
    const subscription = await embedText('I get home from work');
    const change = await embedText(
      describeStateChange({
        source: 'internet-of-things',
        stateType: 'presence_changed',
        stateData: { person: 'Mathias', state: 'arrived home' },
      }),
    );

    // Measured at 0.14 — less than half the floor, so no threshold tweak recovers it.
    expect(cosineSimilarity(subscription, change)).toBeLessThan(DEFAULT_MINIMUM_SCORE);
  });

  it('connects the same event once the WHEN is phrased as an event', async () => {
    const change = await embedText(
      describeStateChange({
        source: 'internet-of-things',
        stateType: 'presence_changed',
        stateData: { person: 'Mathias', state: 'arrived home' },
      }),
    );

    const firstPerson = cosineSimilarity(await embedText('I get home from work'), change);
    const eventPhrased = cosineSimilarity(await embedText('a person arrives home'), change);

    // 0.14 -> 0.40. The retrieval failure is in how the subscription was worded, not
    // in the matcher, so the lever that matters is the wording registerSubscription
    // asks the LLM for.
    expect(eventPhrased).toBeGreaterThan(firstPerson);
    expect(eventPhrased).toBeGreaterThanOrEqual(DEFAULT_MINIMUM_SCORE);
  });

  it('loses signal as unshared tokens are added, which is why wording dominates', async () => {
    const subscription = await embedText('I get home from work');
    const score = async (text: string) => cosineSimilarity(subscription, await embedText(text));

    const bare = await score('arrived home');
    const withNoun = await score('person arrived home');
    const withName = await score('Mathias arrived home');

    // Mean-pooling: each token that shares no meaning with the subscription drags the
    // average down, so *adding true detail* makes the match worse. 0.32 -> 0.28 -> 0.21.
    expect(bare).toBeGreaterThan(withNoun);
    expect(withNoun).toBeGreaterThan(withName);
  });
});

describe('the state change description feeding the embedder', () => {
  it('keeps the source and type heading, which carries real signal', async () => {
    const change: StateChange = {
      source: 'internet-of-things',
      stateType: 'air_quality_changed',
      stateData: { co2_ppm: 1400, quality: 'poor' },
    };

    const full = await embedText(describeStateChange(change));
    const detailsOnly = await embedText('co2 ppm is 1400, quality is poor');
    const target = subscriptions.find((subscription) => subscription.id === 'co2');

    if (!target) {
      throw new Error('The co2 subscription is missing from the corpus');
    }

    // The payload alone is numbers and a vague adjective; "air quality changed" is
    // what actually resembles "the air quality gets bad". Dropping the heading to
    // reduce dilution measured worse overall (81% recall against 88%).
    expect(cosineSimilarity(full, target.whenEmbedding)).toBeGreaterThan(
      cosineSimilarity(detailsOnly, target.whenEmbedding),
    );
  });

  it('humanises identifiers, because underscores embed poorly', () => {
    const description = describeStateChange({
      source: 'weather',
      stateType: 'sun_position_changed',
      stateData: { event: 'sunset' },
    });

    expect(description).toBe('weather sun position changed: event is sunset');
    expect(description).not.toContain('_');
  });
});

describe('matching cost', () => {
  it('matches a state change against a large subscription set in single-digit milliseconds', async () => {
    // Warm the static table: the first call loads it (~130ms), every later call is a
    // lookup. Charging that once-per-process cost to the first match would mislead.
    await embedText('warm up');

    const many = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        embedDraft({ id: `filler-${index}`, whenEvent: `filler event number ${index}`, thenAction: 'do nothing' }),
      ),
    );

    const description = describeStateChange(PROBES[0].change);
    const started = performance.now();
    rankSubscriptions(await embedText(description), many);
    const elapsed = performance.now() - started;

    // Measured around 2.8ms (2.7 to embed, 0.06 to rank 100). The ceiling is loose
    // because CI machines vary; it exists to catch a change in kind — swapping the
    // static embedder for a hosted one would blow straight through it.
    expect(elapsed).toBeLessThan(50);
  });

  it('embeds a batch far more cheaply per item than one at a time', async () => {
    await embedText('warm up');

    const texts = Array.from({ length: 20 }, (_, index) => `weather temperature changed: temperature is ${index}`);

    const batchStarted = performance.now();
    await embedTexts(texts);
    const batched = performance.now() - batchStarted;

    const individualStarted = performance.now();
    for (const text of texts) {
      await embedText(text);
    }
    const individual = performance.now() - individualStarted;

    // Measured at 0.2ms per text batched against 2.7ms individually. This is why the
    // batcher embeds a whole batch in one pass instead of looping per change.
    expect(batched).toBeLessThan(individual);
  });
});
