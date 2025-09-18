import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

// Schema for weather workflow input
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

// Main weather workflow
const weatherWorkflow = createWorkflow({
  id: 'weather-workflow',
  inputSchema: weatherInputSchema,
  outputSchema: weatherOutputSchema,
})
  .then(processWeatherRequest);

weatherWorkflow.commit();

export { weatherWorkflow };