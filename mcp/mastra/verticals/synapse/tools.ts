import { z } from 'zod';
import { createTool } from '../../utils/tool-factory.js';
import { stateChangeBatcher } from './state-change-batcher.js';
import { stateChangeNotificationWorkflow } from './workflows.js';

// Register state change tool for reactive notifications
// This tool uses a batcher to optimize token usage by processing multiple state changes together
export const registerStateChange = createTool({
  id: 'registerStateChange',
  description:
    'Registers a state change event. State changes are batched and processed together to optimize token usage. Use this when significant state changes occur that might warrant user notification.',
  inputSchema: z.object({
    source: z
      .string()
      .describe('The agent/vertical that detected the state change (e.g., "weather", "shopping", "calendar")'),
    stateType: z
      .string()
      .describe('Type of state change (e.g., "weather_update", "task_completed", "significant_temperature_change")'),
    stateData: z.record(z.unknown()).describe('State change data payload containing relevant information'),
  }),
  outputSchema: z.object({
    registered: z.boolean(),
    batched: z
      .boolean()
      .describe('True if the change is waiting in the batch queue, false if it was processed immediately'),
    message: z.string(),
  }),
  execute: async (inputData) => {
    try {
      console.log(`📝 Registering state change: ${inputData.stateType} from ${inputData.source}`);

      // Add to batcher for optimized processing
      await stateChangeBatcher.add({
        source: inputData.source,
        stateType: inputData.stateType,
        stateData: inputData.stateData,
      });

      const stats = stateChangeBatcher.getStats();
      return {
        registered: true,
        batched: stats.pendingCount > 0,
        message: `State change ${inputData.stateType} registered. Batch: ${stats.pendingCount} pending, ${stats.totalProcessed} processed`,
      };
    } catch (error) {
      console.error('❌ Failed to register state change:', error);
      throw error;
    }
  },
});

// Tool to flush pending state changes immediately
export const flushStateChanges = createTool({
  id: 'flushStateChanges',
  description:
    'Immediately process all pending state changes without waiting for the batch timeout. Useful when you need immediate processing of accumulated changes.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    flushed: z.boolean(),
    processedCount: z.number(),
    message: z.string(),
  }),
  execute: async () => {
    const statsBefore = stateChangeBatcher.getStats();
    await stateChangeBatcher.flush();
    const statsAfter = stateChangeBatcher.getStats();

    const processedInFlush = statsAfter.totalProcessed - statsBefore.totalProcessed;

    return {
      flushed: true,
      processedCount: processedInFlush,
      message: `Flushed ${processedInFlush} state changes. Total: ${statsAfter.totalProcessed} processed, ${statsAfter.batchesProcessed} batches`,
    };
  },
});

// Tool to get batcher statistics
export const getStateChangeBatcherStats = createTool({
  id: 'getStateChangeBatcherStats',
  description: 'Get current statistics for the state change batcher, including pending changes and processing status.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    totalReceived: z.number(),
    totalProcessed: z.number(),
    batchesProcessed: z.number(),
    pendingCount: z.number(),
    isProcessing: z.boolean(),
    droppedCount: z.number().describe('Number of state changes dropped after exceeding retry limit'),
  }),
  execute: async () => {
    return stateChangeBatcher.getStats();
  },
});

export const synapseTools = {
  registerStateChange,
  flushStateChanges,
  getStateChangeBatcherStats,
};

// Re-export the workflow for backward compatibility
export { stateChangeNotificationWorkflow };
