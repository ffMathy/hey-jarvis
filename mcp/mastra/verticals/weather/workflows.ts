import { z } from 'zod';
import { createAgentStep, createStep, createWorkflow } from '../../utils/workflow-factory.js';

// Agent-as-step for scheduled weather check using workflow state
const scheduledWeatherCheck = createAgentStep({
  id: 'scheduled-weather-check',
  description: 'Checks weather for Mathias every hour',
  agentName: 'weather',
  inputSchema: z.object({}),
  outputSchema: z.object({
    result: z.string(),
  }),
  prompt: () => 'Get current weather for Mathias, Denmark',
});

// Store weather result in workflow state
const storeWeatherResult = createStep({
  id: 'store-weather-result',
  description: 'Stores weather result in workflow state',
  inputSchema: z.object({
    result: z.string(),
  }),
  outputSchema: z.object({}),
  execute: async ({ context, workflow }) => {
    workflow.setState({
      weatherResult: context.result,
    });
    return {};
  },
});

// Transform weather data into memory update format using workflow state
const transformToMemoryUpdate = createStep({
  id: 'transform-to-memory-update',
  description: 'Transform weather data into memory update format',
  inputSchema: z.object({}),
  outputSchema: z.object({
    memoryUpdate: z
      .object({
        context: z.string(),
        events: z.array(
          z.object({
            type: z.string(),
            information: z.any(),
          }),
        ),
      })
      .optional(),
  }),
  execute: async ({ workflow }) => {
    const state = workflow.state;

    // Create memory update event
    const memoryUpdate = {
      context: 'The weather has changed.',
      events: [
        {
          type: 'weather-changed',
          information: state.weatherResult,
        },
      ],
    };

    return {
      memoryUpdate,
    };
  },
});

// Scheduled weather monitoring workflow using workflow state
export const weatherMonitoringWorkflow = createWorkflow({
  id: 'weather-monitoring-workflow',
  inputSchema: z.object({}),
  outputSchema: z.object({
    memoryUpdate: z
      .object({
        context: z.string(),
        events: z.array(
          z.object({
            type: z.string(),
            information: z.any(),
          }),
        ),
      })
      .optional(),
  }),
})
  .then(scheduledWeatherCheck)
  .then(storeWeatherResult)
  .then(transformToMemoryUpdate)
  .commit();
