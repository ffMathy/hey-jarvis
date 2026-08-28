import { z } from 'zod';
import { createTool } from '../../utils/tool-factory.js';
import { registerStateChangeNotification } from './state-change-notifier.js';
import { subscriptionTools } from './subscription-tools.js';
import { stateChangeNotificationWorkflow } from './workflows.js';

/**
 * Files a state change for the State Change Reactor.
 *
 * Batching, duplicate suppression and retry all live in Mastra's notification pipeline
 * now, so this tool only has to hand the change over. See
 * {@link ./state-change-notifier.ts} for what replaced the old in-memory batcher.
 */
export const registerStateChange = createTool({
  id: 'registerStateChange',
  description:
    'Registers a state change event. Changes are filed as notifications for the State Change Reactor, which sees them rolled up rather than one at a time. Identical repeats of a change collapse into the record already waiting. Use this when significant state changes occur that might warrant user notification.',
  inputSchema: z.object({
    source: z
      .string()
      .describe('The agent/vertical that detected the state change (e.g., "weather", "shopping", "calendar")'),
    stateType: z
      .string()
      .describe('Type of state change (e.g., "weather_update", "task_completed", "significant_temperature_change")'),
    stateData: z.record(z.string(), z.unknown()).describe('State change data payload containing relevant information'),
  }),
  outputSchema: z.object({
    registered: z.boolean(),
    duplicate: z.boolean().describe('True if this collapsed into a change that was already waiting'),
    message: z.string(),
  }),
  execute: async (inputData, context) => {
    if (!context.mastra) {
      // Not defensive padding: the reactor's notification storage is reached through the
      // Mastra instance it is registered on, so without one there is nowhere to file this.
      throw new Error('registerStateChange needs a Mastra instance to file the change against.');
    }

    const result = await registerStateChangeNotification(
      {
        source: inputData.source,
        stateType: inputData.stateType,
        stateData: inputData.stateData,
      },
      context.mastra,
    );

    return {
      registered: true,
      duplicate: result.duplicate,
      message: result.duplicate
        ? `State change ${inputData.stateType} matched one already waiting; nothing new was queued.`
        : `State change ${inputData.stateType} registered (${result.action}).`,
    };
  },
});

export const synapseTools = {
  registerStateChange,
  ...subscriptionTools,
};

export {
  findRelevantSubscriptions,
  listSubscriptions,
  markSubscriptionTriggered,
  registerSubscription,
  removeSubscription,
  setSubscriptionEnabled,
  subscriptionTools,
} from './subscription-tools.js';

// Re-export the workflow for backward compatibility
export { stateChangeNotificationWorkflow };
