import { z } from 'zod';
import { createAgentStep, createStep, createWorkflow } from '../../utils/workflow-factory.js';

// Agent-as-step for scheduled weather check
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

// Transform weather data into memory update format
// Data flows through context - no state needed since result only used once
const transformToMemoryUpdate = createStep({
  id: 'transform-to-memory-update',
  description: 'Transform weather data into memory update format',
  inputSchema: z.object({
    result: z.string(),
  }),
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
  execute: async (params) => {
    // Create memory update event from context (no state needed)
    const memoryUpdate = {
      context: 'The weather has changed.',
      events: [
        {
          type: 'weather-changed',
          information: params.inputData.result,
        },
      ],
    };

    return {
      memoryUpdate,
    };
  },
});

// Scheduled weather monitoring workflow
// No state needed - data flows directly through context from step to step
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
  .then(transformToMemoryUpdate)
  .commit();
