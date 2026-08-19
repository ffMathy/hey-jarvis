/**
 * Batcher-to-prompt integration.
 *
 * This is the whole synapse pipeline with the language model taken out: a state
 * change goes into the batcher, real Model2Vec embeddings are compared against
 * real subscriptions in a real (temporary) database, and the prompt that *would*
 * have gone to the reactor agent is captured instead of sent.
 *
 * Asserting on that prompt is the point. Everything upstream of it is
 * deterministic and testable; everything downstream is the LLM's judgement, which
 * is neither. So the contract worth pinning is "the right candidate subscriptions
 * reach the prompt, and the wrong ones do not".
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { type SubscriptionEmbeddings, SubscriptionStorage } from '../../storage/subscriptions.js';
import { embedText } from '../../utils/static-embedder.js';

const databaseDirectory = await mkdtemp(path.join(tmpdir(), 'synapse-batcher-subscriptions-'));
const storage = new SubscriptionStorage(path.join(databaseDirectory, 'subscriptions.db'));

/** Every prompt the batcher has handed to the reactor agent. */
const prompts: string[] = [];

mock.module('./agent.js', () => ({
  getStateChangeReactorAgent: async () => ({
    network: async (prompt: string) => {
      prompts.push(prompt);
      return { result: { registered: true, analyzed: true } };
    },
  }),
}));

mock.module('../../memory/index.js', () => ({
  createMemory: async () => ({
    saveMessages: async () => {},
  }),
}));

mock.module('../../storage/index.js', () => ({
  getSubscriptionStorage: async () => storage,
}));

const { StateChangeBatcher } = await import('./state-change-batcher.js');

async function embeddingsFor(
  whenEvent: string,
  thenAction: string,
  givenCondition?: string,
): Promise<SubscriptionEmbeddings> {
  return {
    whenEvent: await embedText(whenEvent),
    thenAction: await embedText(thenAction),
    givenCondition: givenCondition ? await embedText(givenCondition) : null,
  };
}

async function seed(whenEvent: string, thenAction: string, givenCondition?: string) {
  return await storage.add(
    { source: 'user', whenEvent, thenAction, givenCondition, oneShot: false },
    await embeddingsFor(whenEvent, thenAction, givenCondition),
  );
}

/** Runs a batch through and returns the single prompt it produced. */
async function promptFor(changes: Array<{ source: string; stateType: string; stateData: Record<string, unknown> }>) {
  const batcher = new StateChangeBatcher(10_000, 100);
  for (const change of changes) {
    await batcher.add(change);
  }
  await batcher.flush();

  expect(prompts.length).toBe(1);
  return prompts[0];
}

beforeEach(async () => {
  await storage.clear();
  prompts.length = 0;
});

/**
 * The temporary directory is deliberately not removed afterwards.
 *
 * `mock.module` is process-global in Bun, and test files share one process, so the
 * substitution above stays in force for every file that runs after this one. Deleting
 * the directory at the end of this file pulls the database out from under those files
 * mid-run, which SQLite reports as SQLITE_READONLY_DBMOVED rather than anything that
 * points back here. The directory lives under the OS temp dir and is cleaned up there.
 */
describe('candidate subscriptions reaching the reactor prompt', () => {
  it('puts the matching subscription in the prompt, with all three components', async () => {
    await seed('the sun goes down', 'close the blinds', 'the lights are on');

    const prompt = await promptFor([
      { source: 'weather', stateType: 'sun_position_changed', stateData: { event: 'sunset', elevation: -0.5 } },
    ]);

    expect(prompt).toContain('WHEN: the sun goes down');
    expect(prompt).toContain('GIVEN: the lights are on');
    // The THEN is never scored, but the agent cannot act without it.
    expect(prompt).toContain('THEN: close the blinds');
    expect(prompt).toContain('similarity');
  });

  it('leaves unrelated subscriptions out of the prompt entirely', async () => {
    await seed('the sun goes down', 'close the blinds', 'the lights are on');
    await seed('the milk in the fridge expires', 'add milk to the shopping list');
    await seed('there is heavy traffic on my route', 'suggest leaving earlier');

    const prompt = await promptFor([
      { source: 'weather', stateType: 'sun_position_changed', stateData: { event: 'sunset', elevation: -0.5 } },
    ]);

    expect(prompt).toContain('close the blinds');
    expect(prompt).not.toContain('add milk to the shopping list');
    expect(prompt).not.toContain('suggest leaving earlier');
  });

  it('says so plainly when nothing matched, rather than omitting the section', async () => {
    await seed('the milk in the fridge expires', 'add milk to the shopping list');

    const prompt = await promptFor([
      {
        source: 'coding',
        stateType: 'pull_request_opened',
        stateData: { repository: 'hey-jarvis', title: 'Refactor the deployment script' },
      },
    ]);

    expect(prompt).toContain('No subscriptions matched this state change.');
    expect(prompt).not.toContain('add milk to the shopping list');
  });

  it('handles an empty subscription set without matching anything', async () => {
    const prompt = await promptFor([
      { source: 'weather', stateType: 'sun_position_changed', stateData: { event: 'sunset' } },
    ]);

    expect(prompt).toContain('No subscriptions matched this state change.');
  });

  it('gives each change in a batch its own candidate list', async () => {
    await seed('the sun goes down', 'close the blinds', 'the lights are on');
    await seed('the washing machine finishes', 'remind me to hang the laundry');

    const prompt = await promptFor([
      { source: 'weather', stateType: 'sun_position_changed', stateData: { event: 'sunset' } },
      {
        source: 'internet-of-things',
        stateType: 'appliance_finished',
        stateData: { appliance: 'washing machine', cycle: 'complete' },
      },
    ]);

    // One LLM call covering both changes, each carrying its own shortlist.
    expect(prompt).toContain('close the blinds');
    expect(prompt).toContain('remind me to hang the laundry');
    expect(prompt.indexOf('close the blinds')).toBeLessThan(prompt.indexOf('remind me to hang the laundry'));
  });

  it('does not offer disabled subscriptions as candidates', async () => {
    const spent = await seed('the washing machine finishes', 'remind me to hang the laundry');
    await storage.setEnabled(spent.id, false);

    const prompt = await promptFor([
      {
        source: 'internet-of-things',
        stateType: 'appliance_finished',
        stateData: { appliance: 'washing machine', cycle: 'complete' },
      },
    ]);

    expect(prompt).not.toContain('remind me to hang the laundry');
    expect(prompt).toContain('No subscriptions matched this state change.');
  });

  it('marks one-shot subscriptions so the agent knows they are single-use', async () => {
    await storage.add(
      {
        source: 'user',
        whenEvent: 'the washing machine finishes',
        thenAction: 'remind me to hang the laundry',
        oneShot: true,
      },
      await embeddingsFor('the washing machine finishes', 'remind me to hang the laundry'),
    );

    const prompt = await promptFor([
      {
        source: 'internet-of-things',
        stateType: 'appliance_finished',
        stateData: { appliance: 'washing machine', cycle: 'complete' },
      },
    ]);

    expect(prompt).toContain('(one-shot)');
  });

  it('tells the agent the candidates are suggestions rather than decisions', async () => {
    await seed('the sun goes down', 'close the blinds');

    const prompt = await promptFor([
      { source: 'weather', stateType: 'sun_position_changed', stateData: { event: 'sunset' } },
    ]);

    // Retrieval is deliberately generous, so the prompt has to say that a candidate
    // can be a false match and that the GIVEN still needs checking.
    expect(prompt).toContain('suggestions, not decisions');
    expect(prompt).toContain('markSubscriptionTriggered');
  });
});

describe('batching behaviour around matching', () => {
  it('collapses a burst of changes into a single agent call', async () => {
    await seed('the sun goes down', 'close the blinds');

    const batcher = new StateChangeBatcher(10_000, 100);
    for (let index = 0; index < 5; index++) {
      await batcher.add({
        source: 'internet-of-things',
        stateType: 'device_state_changed',
        stateData: { device: `lamp ${index}`, state: 'on' },
      });
    }
    await batcher.flush();

    // Five changes, one embedding pass, one prompt, one LLM call.
    expect(prompts.length).toBe(1);
    expect(batcher.getStats().totalProcessed).toBe(5);
  });

  it('does not call the agent at all when there is nothing pending', async () => {
    const batcher = new StateChangeBatcher(10_000, 100);
    await batcher.flush();

    expect(prompts.length).toBe(0);
  });
});
