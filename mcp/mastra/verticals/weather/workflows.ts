import { z } from 'zod';
import { ollamaModel } from '../../utils/providers/ollama-provider.js';
import { isValidationError } from '../../utils/validation-error.js';
import { createAgentStep, createStep, createWorkflow } from '../../utils/workflows/workflow-factory.js';
import { registerStateChange } from '../synapse/tools.js';
import { weatherTools } from './tools.js';

// Agent-as-step for scheduled weather check (uses local Qwen3 via Ollama for cost-efficiency)
const scheduledWeatherCheck = createAgentStep({
  id: 'scheduled-weather-check',
  description: 'Checks weather for Aarhus every hour',
  agentConfig: {
    model: ollamaModel,
    id: 'weather',
    name: 'Weather',
    instructions: `You are a weather agent which can provide weather insights via tools (current weather information and 5-day future prognosises for certain locations).

If no location is given, assume the city Aarhus in Denmark, where Mathias and Julie lives.

When users ask for weather information:
1. If they provide a city name, use the city-based tools
2. If they provide coordinates, use the coordinate-based tools
3. If no location is specified, default to "aarhus,dk"
4. For forecast requests, use the forecast tools
5. For current conditions, use the current weather tools

Always provide comprehensive weather information including temperature, humidity, wind conditions, and weather descriptions.`,
    description: `# Purpose  
Provide weather data. Use this tool to **fetch the current conditions** or a **5-day forecast** for any location specified by city name, postal/ZIP code, or latitude/longitude coordinates. **Location is mandatory.**  

# When to use
- The user asks about today's weather, tomorrow's forecast, or the outlook for specific dates ("Will it rain in Paris this weekend?").
- The user needs details for planning travel or outdoor activities (temperature, precipitation chance, wind, humidity, UV index, sunrise/sunset).
- The user wants to compare weather between multiple places or check conditions along a route.
- Severe-weather awareness: the user is concerned about storms, heatwaves, cold snaps, or air-quality alerts.
- Any automation (e.g., deciding whether to water the lawn) requires up-to-date weather data first.

# Post-processing  
- **Validate** the query succeeded and capture key metrics (current temp, feels-like, condition, wind, humidity, plus daily highs/lows and precipitation probabilities for five days).
- **Summarize** clearly: current conditions first, followed by the 5-day outlook—use concise prose or a compact list; avoid overwhelming detail.
- **Convert units** to match the user's locale or stated preference (°C/°F, mm/in, km/h/mph); note conversions if they differ from the source.
- **Highlight significant events** (e.g., "Thunderstorms expected Thursday afternoon") and offer brief guidance if relevant.`,
    tools: weatherTools,
  },
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
    batched: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ inputData }) => {
    const stateChangeData = {
      source: 'weather',
      stateType: 'weather_update',
      stateData: {
        location: 'Aarhus, Denmark',
        weatherInfo: inputData.result,
        timestamp: new Date().toISOString(),
      },
    };

    if (!registerStateChange.execute) {
      throw new Error('registerStateChange.execute is not defined');
    }
    const result = await registerStateChange.execute(stateChangeData, params.context);

    // Handle validation error case using type guard for proper narrowing
    if (isValidationError(result)) {
      throw new Error(`Failed to register state change: ${result.message}`);
    }

    return result;
  },
});

// Scheduled weather monitoring workflow
// Data flows through context and registers state changes for notification analysis
export const weatherMonitoringWorkflow = createWorkflow({
  id: 'weatherMonitoringWorkflow',
  inputSchema: z.object({}),
  outputSchema: z.object({
    registered: z.boolean(),
    batched: z.boolean(),
    message: z.string(),
  }),
})
  .then(scheduledWeatherCheck)
  .then(registerWeatherStateChange)
  .commit();
