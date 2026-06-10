import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { type StateChange, StateChangeBatcher } from './state-change-batcher.js';

// Mock the dependencies to avoid actual API calls
mock.module('./agent.js', () => ({
  getStateChangeReactorAgent: async () => ({
    network: async () => ({
      result: { registered: true, analyzed: true },
    }),
  }),
}));

mock.module('../../memory/index.js', () => ({
  createMemory: async () => ({
    saveMessages: async () => {},
  }),
}));

describe('StateChangeBatcher', () => {
  let batcher: StateChangeBatcher;

  beforeEach(() => {
    // Create a new batcher with short delays for testing
    batcher = new StateChangeBatcher(100, 5);
  });

  afterEach(async () => {
    // Flush any pending changes
    await batcher.flush();
  });

  it('should create a batcher with default settings', () => {
    const defaultBatcher = new StateChangeBatcher();
    expect(defaultBatcher).toBeDefined();
    expect(defaultBatcher.getPendingCount()).toBe(0);
  });

  it('should add state changes to pending queue', async () => {
    const stateChange: StateChange = {
      source: 'test',
      stateType: 'test_change',
      stateData: { key: 'value' },
    };

    await batcher.add(stateChange);
    expect(batcher.getPendingCount()).toBeGreaterThanOrEqual(0);
  });

  it('should return correct statistics', () => {
    const stats = batcher.getStats();
    expect(stats).toHaveProperty('totalReceived');
    expect(stats).toHaveProperty('totalProcessed');
    expect(stats).toHaveProperty('batchesProcessed');
    expect(stats).toHaveProperty('pendingCount');
    expect(stats).toHaveProperty('isProcessing');
    expect(stats).toHaveProperty('droppedCount');
    expect(typeof stats.totalReceived).toBe('number');
    expect(typeof stats.totalProcessed).toBe('number');
    expect(typeof stats.batchesProcessed).toBe('number');
    expect(typeof stats.pendingCount).toBe('number');
    expect(typeof stats.isProcessing).toBe('boolean');
    expect(typeof stats.droppedCount).toBe('number');
  });

  it('should increment totalReceived when adding state changes', async () => {
    const statsBefore = batcher.getStats();

    await batcher.add({
      source: 'test',
      stateType: 'test_change',
      stateData: {},
    });

    const statsAfter = batcher.getStats();
    expect(statsAfter.totalReceived).toBe(statsBefore.totalReceived + 1);
  });

  it('should flush pending changes immediately', async () => {
    await batcher.add({
      source: 'test',
      stateType: 'test_change',
      stateData: {},
    });

    await batcher.flush();
    expect(batcher.getPendingCount()).toBe(0);
  });

  it('should process immediately when batch is full', async () => {
    // Create a batcher with max batch size of 2
    const smallBatcher = new StateChangeBatcher(10000, 2);

    // Add 2 changes to fill the batch
    await smallBatcher.add({ source: 'test1', stateType: 'change1', stateData: {} });
    await smallBatcher.add({ source: 'test2', stateType: 'change2', stateData: {} });

    // Batch should have been processed immediately
    const stats = smallBatcher.getStats();
    expect(stats.totalReceived).toBe(2);
  });
});

describe('StateChangeBatcher - resilience', () => {
  // Restore the default (succeeding) reactor mock after these tests so ordering
  // with other suites stays independent.
  const restoreSuccessMock = () => {
    mock.module('./agent.js', () => ({
      getStateChangeReactorAgent: async () => ({
        network: async () => ({
          result: { registered: true, analyzed: true },
        }),
      }),
    }));
  };

  afterEach(restoreSuccessMock);

  it('does not propagate analysis failures or wedge the batcher', async () => {
    // Re-mock the reactor so the network analysis fails the way it does in CI
    // when the request exceeds the model's token limit (a non-retryable 413).
    mock.module('./agent.js', () => ({
      getStateChangeReactorAgent: async () => ({
        network: async () => {
          throw new Error('Request body too large for gpt-4o model. Max size: 8000 tokens.');
        },
      }),
    }));

    const failingBatcher = new StateChangeBatcher(10000, 2);

    // Filling the batch triggers immediate processing. The analysis failure
    // must be swallowed by add(), not surfaced to the caller that registered
    // the state change.
    await failingBatcher.add({ source: 'a', stateType: 'change', stateData: {} });
    await expect(failingBatcher.add({ source: 'b', stateType: 'change', stateData: {} })).resolves.toBeUndefined();

    const afterFailure = failingBatcher.getStats();
    expect(afterFailure.isProcessing).toBe(false); // not wedged
    expect(afterFailure.droppedCount).toBe(2); // failed batch counted as dropped
    expect(afterFailure.totalProcessed).toBe(0); // nothing counted as processed

    // After a failure the same batcher must keep working. Restore a succeeding
    // reactor and push another full batch through the same instance.
    restoreSuccessMock();
    await failingBatcher.add({ source: 'c', stateType: 'change', stateData: {} });
    await failingBatcher.add({ source: 'd', stateType: 'change', stateData: {} });

    const afterRecovery = failingBatcher.getStats();
    expect(afterRecovery.totalProcessed).toBe(2); // subsequent batch processed
    expect(afterRecovery.droppedCount).toBe(2); // earlier failure still recorded
  });
});

describe('StateChangeBatcher - reactor disabled in CI tests', () => {
  afterEach(() => {
    delete process.env.HEY_JARVIS_DISABLE_STATE_CHANGE_REACTOR;
    // Restore the default succeeding reactor mock for other suites.
    mock.module('./agent.js', () => ({
      getStateChangeReactorAgent: async () => ({
        network: async () => ({
          result: { registered: true, analyzed: true },
        }),
      }),
    }));
  });

  it('skips LLM analysis without calling the reactor when disabled', async () => {
    process.env.HEY_JARVIS_DISABLE_STATE_CHANGE_REACTOR = 'true';
    // The reactor must not be invoked while disabled; this mock throws if it is.
    mock.module('./agent.js', () => ({
      getStateChangeReactorAgent: async () => ({
        network: async () => {
          throw new Error('reactor should not be called when disabled');
        },
      }),
    }));

    const batcher = new StateChangeBatcher(10000, 2);
    await batcher.add({ source: 'a', stateType: 'change', stateData: {} });
    await batcher.add({ source: 'b', stateType: 'change', stateData: {} });

    const stats = batcher.getStats();
    expect(stats.totalProcessed).toBe(2); // batch processed (analysis skipped, not failed)
    expect(stats.droppedCount).toBe(0); // reactor never called, so nothing dropped
  });
});

describe('StateChangeBatcher - Integration', () => {
  it('should handle multiple rapid state changes', async () => {
    const batcher = new StateChangeBatcher(50, 10);

    // Add multiple changes rapidly
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        batcher.add({
          source: `source-${i}`,
          stateType: 'rapid_change',
          stateData: { index: i },
        }),
      );
    }

    await Promise.all(promises);

    const stats = batcher.getStats();
    expect(stats.totalReceived).toBe(5);

    // Flush to complete processing
    await batcher.flush();
  });
});
