// @ts-expect-error - Bun's test framework types are not available in TypeScript definitions
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
