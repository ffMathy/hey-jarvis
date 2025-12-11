import { describe, expect, it } from 'bun:test';
import { isValidationError } from '../../utils/test-helpers/validation-error.js';
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

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

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

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

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

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      // Validate structure
      expect(result).toBeDefined();
      expect(result.flushed).toBe(true);
      expect(typeof result.processedCount).toBe('number');
      expect(typeof result.message).toBe('string');

      console.log('✅ State changes flushed successfully');
      console.log('   - Processed count:', result.processedCount);
    }, 15000);
  });
});
