import { z } from 'zod';
import { createTool } from '../../utils/tool-factory.js';
import { stateChangeNotificationWorkflow } from './workflows.js';

// Register state change tool for reactive notifications
// This tool simply forwards the state change to the workflow for processing
export const registerStateChange = createTool({
  id: 'registerStateChange',
  description:
    'Registers a state change event and triggers the state change notification workflow. Use this when significant state changes occur that might warrant user notification.',
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
    triggeredWorkflow: z.boolean(),
    message: z.string(),
  }),
  execute: async (inputData) => {
    try {
      console.log(`📝 Registering state change: ${inputData.stateType} from ${inputData.source}`);

      const run = await stateChangeNotificationWorkflow.createRun();
      run
        .start({
          inputData,
        })
        .catch((error: Error) => {
          console.error(`❌ State change workflow error:`, error);
        });

      return {
        registered: true,
        triggeredWorkflow: true,
        message: `State change ${inputData.stateType} registered and workflow triggered`,
      };
    } catch (error) {
      console.error('❌ Failed to register state change:', error);
      throw error;
    }
  },
});

export const synapseTools = {
  registerStateChange,
};
