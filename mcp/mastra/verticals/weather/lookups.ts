import { tz } from '@date-fns/tz';
import { format } from 'date-fns';
import { countBy, maxBy, minBy } from 'lodash-es';
import { asFacts, createDirectLookup, type LookupToolCaller } from '../../utils/direct-lookup-factory.js';
import { HOUSEHOLD_TIME_ZONE } from '../../utils/household.js';
import { logger } from '../../utils/logger.js';
import { getPrimaryUserName } from '../presence/shortcuts.js';
import { getUserCurrentLocation } from './shortcuts.js';
import {
  getCurrentWeatherByCity,
  getCurrentWeatherByCoordinates,
  getForecastByCity,
  getForecastByCoordinates,
} from './tools.js';

/**
 * "What is the weather" and "what will the weather be" answered without the agent.
 *
 * Where, as the agent's instructions have it: the primary user's own location when Home Assistant
 * knows it, and Aarhus otherwise. A question naming another place is not one of these lookups, so
 * routing's classifier leaves it to the agent.
 *
 * They report nothing as touched, as the agent's calls would not: a forecast is looked up from the
 * outside world, and locating the user goes through `inferUserLocation`, which is a survey of every
 * person in the house rather than a thing sir places.
 */

/** Where the agent's instructions fall back to when the user cannot be located. */
const HOME_CITY = 'aarhus,dk';

/** How many days of forecast a lookup reports, starting today. */
const FORECAST_DAYS = 3;

type Coordinates = { latitude: number; longitude: number };

/** The primary user's GPS fix, or `undefined` when Home Assistant has none to give. */
async function userCoordinates(callTool: LookupToolCaller): Promise<Coordinates | undefined> {
  try {
    const { users } = await callTool(getUserCurrentLocation, { userName: getPrimaryUserName() });
    const [user] = users;
    return user?.latitude != null && user.longitude != null
      ? { latitude: user.latitude, longitude: user.longitude }
      : undefined;
  } catch (error) {
    logger.warn('Could not locate the user for the weather; using the home city', { error });
    return undefined;
  }
}

/** A forecast entry, as the forecast tools return it. */
interface ForecastEntry {
  datetime: string;
  temperature: number;
  windSpeed: number;
  description: string;
}

/**
 * The forecast as one line per day, in the household's days: the lowest and highest temperature,
 * the strongest wind, and the conditions it mostly is -- which is how the agent is told to report
 * a forecast, rather than every three-hour entry.
 */
export function summariseForecastByDay(forecast: ForecastEntry[], dayCount = FORECAST_DAYS) {
  const byDay = new Map<string, ForecastEntry[]>();
  for (const entry of forecast) {
    // OpenWeatherMap's `dt_txt` is UTC without saying so.
    const day = format(new Date(`${entry.datetime.replace(' ', 'T')}Z`), 'yyyy-MM-dd', {
      in: tz(HOUSEHOLD_TIME_ZONE),
    });
    byDay.set(day, [...(byDay.get(day) ?? []), entry]);
  }

  return [...byDay.entries()].slice(0, dayCount).map(([day, entries]) => {
    const conditionCounts = countBy(entries, (entry) => entry.description);
    return {
      day,
      lowestTemperature: minBy(entries, (entry) => entry.temperature)?.temperature,
      highestTemperature: maxBy(entries, (entry) => entry.temperature)?.temperature,
      strongestWind: maxBy(entries, (entry) => entry.windSpeed)?.windSpeed,
      mostly: maxBy(Object.keys(conditionCounts), (description) => conditionCounts[description]),
    };
  });
}

export const weatherLookups = [
  createDirectLookup({
    id: 'weather.now',
    agentId: 'weather',
    description: 'What the weather is like right now, where the user is or at home',
    answer: async (callTool) => {
      const coordinates = await userCoordinates(callTool);
      const current = coordinates
        ? await callTool(getCurrentWeatherByCoordinates, coordinates)
        : await callTool(getCurrentWeatherByCity, { cityName: HOME_CITY });
      const { coordinates: _coordinates, pressure: _pressure, ...conditions } = current;
      return asFacts({ unitSystem: 'metric (°C, m/s)', ...conditions });
    },
  }),
  createDirectLookup({
    id: 'weather.forecast',
    agentId: 'weather',
    description:
      'What the weather will be later today, tomorrow or over the next few days, where the user is or at home',
    answer: async (callTool) => {
      const coordinates = await userCoordinates(callTool);
      const { location, forecast } = coordinates
        ? await callTool(getForecastByCoordinates, coordinates)
        : await callTool(getForecastByCity, { cityName: HOME_CITY });
      return asFacts({ unitSystem: 'metric (°C, m/s)', location, days: summariseForecastByDay(forecast) });
    },
  }),
];
