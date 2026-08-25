import { describe, expect, it } from 'bun:test';
import { executeTool } from '../../utils/tool-factory.js';
import { synapseTools } from './tools.js';

/**
 * Flushing is the one synapse tool that leaves the process: it hands the batch
 * to the state-change reactor agent, which is a real model call. Registering
 * and inspecting the batcher stop at the queue, so they stay in
 * `tools.spec.ts` and run on every push.
 *
 * This case used to sit in `tools.spec.ts` and pass there, but not on its own
 * merits: `state-change-batcher.spec.ts` substitutes `./agent.js` through
 * `mock.module`, which is process-global in Bun, and it sorts ahead of
 * `tools.spec.ts` in the run. So the flush was answered by that file's stub
 * reactor rather than by an agent, and the case timed out the moment it was run
 * alone. Here there is no such stub, so the timeout is sized for a real model
 * call — in line with the other live-agent specs — rather than for a mock that
 * returned instantly.
 */
describe('Synapse Tools Integration Tests', () => {
  describe('flushStateChanges', () => {
    it('should flush pending state changes', async () => {
      // First register a change
      await executeTool(synapseTools.registerStateChange, {
        source: 'test',
        stateType: 'test_flush',
        stateData: { test: 'data' },
      });

      // Then flush
      const result = await executeTool(synapseTools.flushStateChanges, {});

      // Validate structure
      expect(result).toBeDefined();
      expect(result.flushed).toBe(true);
      expect(typeof result.processedCount).toBe('number');
      expect(typeof result.message).toBe('string');

      console.log('✅ State changes flushed successfully');
      console.log('   - Processed count:', result.processedCount);
    }, 90000);
  });
});
