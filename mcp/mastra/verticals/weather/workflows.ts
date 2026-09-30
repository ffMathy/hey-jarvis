import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import { executeTool } from '../../utils/tool-factory.js';
import { createStep, createWorkflow } from '../../utils/workflows/workflow-factory.js';
import { registerStateChange } from '../synapse/tools.js';
import { getWeatherNotabilityClassifier, judgeWeatherUpdate } from './classifier.js';
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

/**
 * The last update that was filed, which the next one is compared with.
 *
 * Kept in memory because nothing else holds it in a form worth reading back: the filed record is
 * in the reactor's inbox, and the weather API only knows the weather now. Losing it on a restart
 * costs one update that cannot be called routine (see `weatherFilingFrom`).
 *
 * It is the last one *filed* rather than the last one fetched on purpose. Compared hour by hour,
 * a temperature falling a degree an hour is routine every single hour; compared with what was
 * last reported, it adds up until it is a swing worth telling someone about.
 */
let lastFiledWeather: string | undefined;

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
    const filing = await judgeWeatherUpdate(getWeatherNotabilityClassifier(), lastFiledWeather, inputData.result);

    if (!filing.file) {
      logger.info('Routine weather update not filed', { weather: inputData.result, previous: lastFiledWeather });
      return { registered: false, duplicate: false, message: 'Routine weather update; not filed.' };
    }

    const stateChangeData = {
      source: 'weather',
      stateType: 'weather_update',
      // No timestamp in here: the record carries its own creation time, and a timestamp in the
      // data made every update unique, so the notifier's dedupe key -- built from the whole
      // state data -- could never collapse an hour that reported exactly the same weather.
      stateData: {
        location: 'Aarhus, Denmark',
        weatherInfo: inputData.result,
      },
      priority: filing.priority,
    };

    const result = await executeTool(registerStateChange, stateChangeData, { mastra: params.mastra });
    lastFiledWeather = inputData.result;
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
    duplicate: z.boolean(),
    message: z.string(),
  }),
})
  .then(scheduledWeatherCheck)
  .then(registerWeatherStateChange)
  .commit();
