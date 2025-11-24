import { z } from 'zod';
import { createAgentStep, createStep, createWorkflow } from '../../utils/workflow-factory.js';
import { registerStateChange } from '../notification/tools.js';

// Agent-as-step for scheduled weather check
const scheduledWeatherCheck = createAgentStep({
  id: 'scheduled-weather-check',
  description: 'Checks weather for Aarhus every hour',
  agentName: 'weather',
  inputSchema: z.object({}),
  outputSchema: z.object({
    result: z.string(),
  }),
  prompt: () => 'Get current weather for Aarhus, Denmark',
});

// Register weather state change for notification analysis
const registerWeatherStateChange = createStep({
  id: 'register-weather-state-change',
  description: 'Register weather update as state change for notification system',
  inputSchema: z.object({
    result: z.string(),
  }),
  outputSchema: z.object({
    registered: z.boolean(),
    triggeredAnalysis: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    // Transform weather result into state change format
    const stateChangeData = {
      source: 'weather',
      stateType: 'weather_update',
      stateData: {
        location: 'Aarhus, Denmark',
        weatherInfo: inputData.result,
        timestamp: new Date().toISOString(),
      },
    };

    // Execute the registerStateChange tool
    return await registerStateChange.execute(stateChangeData, mastra);
  },
});

// Scheduled weather monitoring workflow
// Data flows through context and registers state changes for notification analysis
export const weatherMonitoringWorkflow = createWorkflow({
  id: 'weatherMonitoringWorkflow',
  inputSchema: z.object({}),
  outputSchema: z.object({
    registered: z.boolean(),
    triggeredAnalysis: z.boolean(),
    message: z.string(),
  }),
})
  .then(scheduledWeatherCheck)
  .then(registerWeatherStateChange)
  .commit();
