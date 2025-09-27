import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

// Step for scheduled weather check (equivalent to n8n's ScheduleTrigger + OpenWeatherMap + ExecuteWorkflow chain)
const scheduledWeatherCheck = createStep({
  id: 'scheduled-weather-check',
  description: 'Checks weather for Aarhus every hour and notifies memory agent of changes',
  inputSchema: z.object({}),
  outputSchema: z.object({
    memoryUpdate: z.object({
      context: z.string(),
      events: z.array(z.object({
        type: z.string(),
        information: z.any(),
      })),
    }).optional(),
  }),
  execute: async ({ mastra }) => {
    const agent = mastra?.getAgent('weatherAgent');
    if (!agent) {
      throw new Error('Weather agent not found');
    }

    // Get current weather for Aarhus (default location)
    const response = await agent.streamVNext([
      {
        role: 'user',
        content: 'Get current weather for Aarhus, Denmark',
      },
    ]);

    let weatherData = '';
    for await (const chunk of response.textStream) {
      weatherData += chunk;
    }

    // Create memory update event (like the n8n ExecuteWorkflow node does)
    const memoryUpdate = {
      context: "The weather has changed.",
      events: [{
        type: "weather-changed",
        information: weatherData
      }]
    };

    return {
      memoryUpdate,
    };
  },
});

// Scheduled weather monitoring workflow (runs periodically)
export const weatherMonitoringWorkflow = createWorkflow({
  id: 'weather-monitoring-workflow',
  inputSchema: z.object({}),
  outputSchema: z.object({
    memoryUpdate: z.object({
      context: z.string(),
      events: z.array(z.object({
        type: z.string(),
        information: z.any(),
      })),
    }).optional(),
  }),
})
  .then(scheduledWeatherCheck);

// Commit the workflows
weatherMonitoringWorkflow.commit();