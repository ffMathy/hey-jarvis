import { describe, expect, it } from 'bun:test';
import { synapseTools } from './tools';

describe('Synapse Tools Integration Tests', () => {
  describe('registerStateChange', () => {
    it('should register a state change successfully', async () => {
      const result = await synapseTools.registerStateChange.execute({
        source: 'test',
        stateType: 'test_state_change',
        stateData: {
          testKey: 'testValue',
          timestamp: new Date().toISOString(),
        },
      });

      // Validate structure
      expect(result).toBeDefined();
      expect(result.registered).toBe(true);
      expect(typeof result.batched).toBe('boolean');
      expect(typeof result.message).toBe('string');

      console.log('✅ State change registered successfully');
      console.log('   - Registered:', result.registered);
      console.log('   - Batched:', result.batched);
      console.log('   - Message:', result.message);
    }, 10000);
  });

  describe('getStateChangeBatcherStats', () => {
    it('should return batcher statistics', async () => {
      const result = await synapseTools.getStateChangeBatcherStats.execute({});

      // Validate structure
      expect(result).toBeDefined();
      expect(typeof result.totalReceived).toBe('number');
      expect(typeof result.totalProcessed).toBe('number');
      expect(typeof result.batchesProcessed).toBe('number');
      expect(typeof result.pendingCount).toBe('number');
      expect(typeof result.isProcessing).toBe('boolean');
      expect(typeof result.droppedCount).toBe('number');

      console.log('✅ Batcher stats retrieved successfully');
      console.log('   - Total received:', result.totalReceived);
      console.log('   - Total processed:', result.totalProcessed);
      console.log('   - Batches processed:', result.batchesProcessed);
      console.log('   - Pending:', result.pendingCount);
    }, 10000);
  });

  describe('flushStateChanges', () => {
    it('should flush pending state changes', async () => {
      // First register a change
      await synapseTools.registerStateChange.execute({
        source: 'test',
        stateType: 'test_flush',
        stateData: { test: 'data' },
      });

      // Then flush
      const result = await synapseTools.flushStateChanges.execute({});

      // Validate structure
      expect(result).toBeDefined();
      expect(result.flushed).toBe(true);
      expect(typeof result.processedCount).toBe('number');
      expect(typeof result.message).toBe('string');

      console.log('✅ State changes flushed successfully');
      console.log('   - Processed count:', result.processedCount);
    }, 15000);
  });

  describe('subscriptions', () => {
    it('should register, retrieve, trigger and remove a Given/When/Then subscription', async () => {
      const registered = await synapseTools.registerSubscription.execute({
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
        const listed = await synapseTools.listSubscriptions.execute({ includeDisabled: false });
        expect(listed.subscriptions.some((subscription) => subscription.id === subscriptionId)).toBe(true);

        // Vector retrieval should surface it from a paraphrase of the WHEN.
        const found = await synapseTools.findRelevantSubscriptions.execute({
          description: 'the sun has gone down and it is getting dark outside',
          minimumScore: 0.3,
          maximumMatches: 5,
        });
        const match = found.matches.find((candidate) => candidate.subscription.id === subscriptionId);
        expect(match).toBeDefined();
        expect(match?.whenScore ?? 0).toBeGreaterThan(0.3);

        // One-shot subscriptions retire once they fire.
        const triggered = await synapseTools.markSubscriptionTriggered.execute({ subscriptionId });
        expect(triggered.triggered).toBe(true);
        expect(triggered.stillEnabled).toBe(false);

        const afterTrigger = await synapseTools.listSubscriptions.execute({ includeDisabled: false });
        expect(afterTrigger.subscriptions.some((subscription) => subscription.id === subscriptionId)).toBe(false);

        console.log('✅ Subscription lifecycle verified');
        console.log('   - Id:', subscriptionId);
        console.log('   - WHEN similarity:', match?.whenScore);
      } finally {
        const removed = await synapseTools.removeSubscription.execute({ subscriptionId });
        expect(removed.removed).toBe(true);
      }
    }, 15000);

    it('should not match a subscription against an unrelated state change', async () => {
      const registered = await synapseTools.registerSubscription.execute({
        whenEvent: 'the milk in the fridge expires',
        thenAction: 'add milk to the shopping list',
        source: 'synapse-tools-spec',
        oneShot: false,
        // Recurring, but not forever: registration insists on an end, so a subscription
        // cannot be created that is scored against every state change indefinitely.
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });

      try {
        const found = await synapseTools.findRelevantSubscriptions.execute({
          description: 'coding pull request opened: title is Refactor the deployment script',
          minimumScore: 0.3,
          maximumMatches: 5,
        });

        expect(found.matches.some((candidate) => candidate.subscription.id === registered.subscription.id)).toBe(false);
      } finally {
        await synapseTools.removeSubscription.execute({ subscriptionId: registered.subscription.id });
      }
    }, 15000);
  });
});
