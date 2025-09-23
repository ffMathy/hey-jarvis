import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

// Schema for weather workflow input (from ExecuteWorkflowTrigger or ChatTrigger)
const weatherInputSchema = z.object({
  prompt: z.string().describe('The prompt for the agent. If asking for the weather, include the location of where to check, preferably using GPS coordinates.'),
});

// Schema for weather workflow output
const weatherOutputSchema = z.object({
  response: z.string().describe('The weather agent response'),
});

// Step to process weather requests using the weather agent
const processWeatherRequest = createStep({
  id: 'process-weather-request',
  description: 'Processes weather requests using the weather agent',
  inputSchema: weatherInputSchema,
  outputSchema: weatherOutputSchema,
  execute: async ({ inputData, mastra }) => {
    if (!inputData) {
      throw new Error('Input data not found');
    }

    const agent = mastra?.getAgent('weatherAgent');
    if (!agent) {
      throw new Error('Weather agent not found');
    }

    // Process the prompt with the weather agent
    const response = await agent.stream([
      {
        role: 'user',
        content: inputData.prompt,
      },
    ]);

    let responseText = '';
    for await (const chunk of response.textStream) {
      responseText += chunk;
    }

    return {
      response: responseText,
    };
  },
});

// Step for scheduled weather check (equivalent to n8n's ScheduleTrigger + OpenWeatherMap + ExecuteWorkflow chain)
const scheduledWeatherCheck = createStep({
  id: 'scheduled-weather-check',
  description: 'Checks weather for ***REMOVED*** every hour and notifies memory agent of changes',
  inputSchema: z.object({}),
  outputSchema: z.object({
    weather: z.object({
      temperature: z.number(),
      feelsLike: z.number(),
      humidity: z.number(),
      pressure: z.number(),
      windSpeed: z.number(),
      condition: z.string(),
      description: z.string(),
      location: z.string(),
    }),
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

    // Get current weather for ***REMOVED*** (default location)
    const response = await agent.stream([
      {
        role: 'user',
        content: 'Get current weather for ***REMOVED***, Denmark',
      },
    ]);

    let weatherData = '';
    for await (const chunk of response.textStream) {
      weatherData += chunk;
    }

    // Parse the weather data (simplified - in real implementation you'd want better parsing)
    const weather = {
      temperature: 0, // Would extract from weatherData
      feelsLike: 0,
      humidity: 0,
      pressure: 0,
      windSpeed: 0,
      condition: 'Unknown',
      description: weatherData,
      location: '***REMOVED***, Denmark',
    };

    // Create memory update event (like the n8n ExecuteWorkflow node does)
    const memoryUpdate = {
      context: "The weather has changed.",
      events: [{
        type: "weather-changed",
        information: weather
      }]
    };

    return {
      weather,
      memoryUpdate,
    };
  },
});

// Main weather workflow (handles both prompt-based and chat-based requests)
export const weatherWorkflow = createWorkflow({
  id: 'weather-workflow',
  inputSchema: weatherInputSchema,
  outputSchema: weatherOutputSchema,
})
  .then(processWeatherRequest);

// Scheduled weather monitoring workflow (runs periodically)
export const weatherMonitoringWorkflow = createWorkflow({
  id: 'weather-monitoring-workflow',
  inputSchema: z.object({}),
  outputSchema: z.object({
    weather: z.object({
      temperature: z.number(),
      feelsLike: z.number(),
      humidity: z.number(),
      pressure: z.number(),
      windSpeed: z.number(),
      condition: z.string(),
      description: z.string(),
      location: z.string(),
    }),
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
weatherWorkflow.commit();
weatherMonitoringWorkflow.commit();