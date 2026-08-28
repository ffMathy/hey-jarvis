import { beforeAll, describe, expect, it } from 'bun:test';
import { Mastra } from '@mastra/core';
import { getSqlStorageProvider } from '../../storage/index.js';
import { executeTool } from '../../utils/tool-factory.js';
import { getStateChangeReactorAgent } from './agent.js';
import { synapseTools } from './tools.js';

/**
 * State changes are filed against the reactor's notification inbox, and
 * `sendNotificationSignal` reaches that storage through the Mastra instance the agent is
 * registered on. So these cases need a real instance with real storage -- a bare agent
 * cannot send a notification at all, which is the failure this setup exists to catch.
 *
 * Still offline: LibSQL is a local file and nothing here calls a model.
 */
let mastra: Mastra;

/**
 * The test database lives at a fixed path and is not torn down between runs, so a fixture
 * with fixed contents would be deduped against the record the previous run left behind.
 * Every case here scopes its state changes to one run instead.
 */
const runId = crypto.randomUUID();

beforeAll(async () => {
  mastra = new Mastra({
    storage: await getSqlStorageProvider(),
    agents: { stateChangeReactor: await getStateChangeReactorAgent() },
  });
});

describe('Synapse Tools Integration Tests', () => {
  describe('registerStateChange', () => {
    it('should register a state change successfully', async () => {
      const result = await executeTool(
        synapseTools.registerStateChange,
        {
          source: 'test',
          stateType: `test_state_change_${runId}`,
          stateData: {
            testKey: 'testValue',
            timestamp: new Date().toISOString(),
          },
        },
        { mastra },
      );

      // Validate structure
      expect(result).toBeDefined();
      expect(result.registered).toBe(true);
      expect(typeof result.duplicate).toBe('boolean');
      expect(typeof result.message).toBe('string');

      console.log('✅ State change registered successfully');
      console.log('   - Registered:', result.registered);
      console.log('   - Duplicate:', result.duplicate);
      console.log('   - Message:', result.message);
    }, 10000);

    it('collapses an identical repeat into the change already waiting', async () => {
      // The batcher this replaced had no duplicate suppression at all, so a poll that
      // re-reported the same reading put it in front of the model again every time.
      const stateChange = {
        source: 'test',
        stateType: `test_duplicate_state_change_${runId}`,
        stateData: { entityId: 'light.kitchen', state: 'on' },
      };

      const first = await executeTool(synapseTools.registerStateChange, stateChange, { mastra });
      const repeat = await executeTool(synapseTools.registerStateChange, stateChange, { mastra });

      expect(first.registered).toBe(true);
      expect(first.duplicate).toBe(false);
      expect(repeat.registered).toBe(true);
      expect(repeat.duplicate).toBe(true);
    }, 10000);

    it('treats a different reading from the same source as its own change', async () => {
      const base = { source: 'test', stateType: `test_distinct_state_change_${runId}` };

      const on = await executeTool(
        synapseTools.registerStateChange,
        { ...base, stateData: { entityId: 'light.hallway', state: 'on' } },
        { mastra },
      );
      const off = await executeTool(
        synapseTools.registerStateChange,
        { ...base, stateData: { entityId: 'light.hallway', state: 'off' } },
        { mastra },
      );

      expect(on.duplicate).toBe(false);
      expect(off.duplicate).toBe(false);
    }, 10000);
  });

  describe('subscriptions', () => {
    it('should register, retrieve, trigger and remove a Given/When/Then subscription', async () => {
      const registered = await executeTool(synapseTools.registerSubscription, {
        whenEvent: 'the sun goes down',
        givenCondition: 'the lights are on',
        thenAction: 'close the blinds',
        source: 'synapse-tools-spec',
        // oneShot is shorthand for maxTriggerCount: 1, which satisfies the requirement
        // that every subscription declares how it ends.
        oneShot: true,
      });

      expect(registered.registered).toBe(true);
      expect(registered.subscription.id).toBeTruthy();
      expect(registered.subscription.oneShot).toBe(true);

      const subscriptionId = registered.subscription.id;

      try {
        const listed = await executeTool(synapseTools.listSubscriptions, { includeDisabled: false });
        expect(listed.subscriptions.some((subscription) => subscription.id === subscriptionId)).toBe(true);

        // Vector retrieval should surface it from a paraphrase of the WHEN.
        const found = await executeTool(synapseTools.findRelevantSubscriptions, {
          description: 'the sun has gone down and it is getting dark outside',
          minimumScore: 0.3,
          maximumMatches: 5,
        });
        const match = found.matches.find((candidate) => candidate.subscription.id === subscriptionId);
        expect(match).toBeDefined();
        expect(match?.whenScore ?? 0).toBeGreaterThan(0.3);

        // One-shot subscriptions retire once they fire.
        const triggered = await executeTool(synapseTools.markSubscriptionTriggered, { subscriptionId });
        expect(triggered.triggered).toBe(true);
        expect(triggered.stillEnabled).toBe(false);

        const afterTrigger = await executeTool(synapseTools.listSubscriptions, { includeDisabled: false });
        expect(afterTrigger.subscriptions.some((subscription) => subscription.id === subscriptionId)).toBe(false);

        console.log('✅ Subscription lifecycle verified');
        console.log('   - Id:', subscriptionId);
        console.log('   - WHEN similarity:', match?.whenScore);
      } finally {
        const removed = await executeTool(synapseTools.removeSubscription, { subscriptionId });
        expect(removed.removed).toBe(true);
      }
    }, 15000);

    it('should not match a subscription against an unrelated state change', async () => {
      const registered = await executeTool(synapseTools.registerSubscription, {
        whenEvent: 'the milk in the fridge expires',
        thenAction: 'add milk to the shopping list',
        source: 'synapse-tools-spec',
        oneShot: false,
        // Recurring, but not forever: registration insists on an end, so a subscription
        // cannot be created that is scored against every state change indefinitely.
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });

      try {
        const found = await executeTool(synapseTools.findRelevantSubscriptions, {
          description: 'coding pull request opened: title is Refactor the deployment script',
          minimumScore: 0.3,
          maximumMatches: 5,
        });

        expect(found.matches.some((candidate) => candidate.subscription.id === registered.subscription.id)).toBe(false);
      } finally {
        await executeTool(synapseTools.removeSubscription, { subscriptionId: registered.subscription.id });
      }
    }, 15000);
  });
});
