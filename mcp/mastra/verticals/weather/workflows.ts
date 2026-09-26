import { z } from 'zod';
import { executeTool } from '../../utils/tool-factory.js';
import { createStep, createWorkflow } from '../../utils/workflows/workflow-factory.js';
import { registerStateChange } from '../synapse/tools.js';
import { type CurrentWeather, getCurrentWeatherByCity } from './tools.js';

/**
 * The current weather as one line of prose, for the notification system to read.
 *
 * Exported for testing.
 */
export function describeCurrentWeather(weather: CurrentWeather): string {
  const gust = weather.windGust === undefined ? '' : ` (gusts ${weather.windGust} m/s)`;

  return (
    `${weather.location}: ${weather.temperature}°C (feels like ${weather.feelsLike}°C, ` +
    `${weather.tempMin}–${weather.tempMax}°C), ${weather.description}. ` +
    `Humidity ${weather.humidity}%, wind ${weather.windSpeed} m/s${gust} from ${weather.windDirection}°, ` +
    `cloud cover ${weather.cloudiness}%, pressure ${weather.pressure} hPa.`
  );
}

/**
 * Fetches the hourly weather for Aarhus.
 *
 * A direct tool call rather than an agent step. The agent step this replaces could not call a
 * tool at all -- `createAgentStep` runs its agent with `toolChoice: 'none'` -- so every hourly
 * update it registered was the model's guess at the weather rather than the weather. The lookup
 * needs no judgement, so it now costs one API call and no model call.
 */
const scheduledWeatherCheck = createStep({
  id: 'scheduled-weather-check',
  description: 'Checks weather for Aarhus every hour',
  inputSchema: z.object({}),
  outputSchema: z.object({
    result: z.string(),
  }),
  execute: async (params) => {
    const weather = await executeTool(getCurrentWeatherByCity, { cityName: 'aarhus,dk' }, { mastra: params.mastra });
    return { result: describeCurrentWeather(weather) };
  },
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
    duplicate: z.boolean(),
    message: z.string(),
  }),
  execute: async (params) => {
    const { inputData } = params;
    const stateChangeData = {
      source: 'weather',
      stateType: 'weather_update',
      stateData: {
        location: 'Aarhus, Denmark',
        weatherInfo: inputData.result,
        timestamp: new Date().toISOString(),
      },
    };

    return await executeTool(registerStateChange, stateChangeData, { mastra: params.mastra });
  },
});

// Scheduled weather monitoring workflow
// Data flows through context and registers state changes for notification analysis
export const weatherMonitoringWorkflow = createWorkflow({
  id: 'weatherMonitoringWorkflow',
  inputSchema: z.object({}),
  outputSchema: z.object({
    registered: z.boolean(),
    duplicate: z.boolean(),
    message: z.string(),
  }),
})
  .then(scheduledWeatherCheck)
  .then(registerWeatherStateChange)
  .commit();
