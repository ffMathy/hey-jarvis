/**
 * The weather lookups, against a faked OpenWeatherMap.
 *
 * Pins how a response becomes a tool's output, and the line the hourly check registers -- which
 * is now read from the weather itself rather than written by a model that could not look it up.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { executeTool } from '../../utils/tool-factory.js';
import { getCurrentWeatherByCity, getForecastByCoordinates } from './tools.js';
import { describeCurrentWeather } from './workflows.js';

const API_KEY_ENV = 'HEY_JARVIS_OPENWEATHERMAP_API_KEY';

const conditions = {
  main: { temp: 12.3, feels_like: 10.1, temp_min: 9.8, temp_max: 13, pressure: 1012, humidity: 80 },
  wind: { speed: 5.1, deg: 240, gust: 9 },
  clouds: { all: 75 },
  weather: [{ main: 'Rain', description: 'light rain' }],
};

/**
 * A stand-in for `fetch` that answers every request with `body`, and records the URLs asked for.
 *
 * Bun's `fetch` carries a `preconnect` function as well as its call signature, so a bare
 * function is not one; the real `preconnect` is carried over to make it whole.
 */
function fakeOpenWeatherMap(body: unknown) {
  const urls: string[] = [];
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        urls.push(String(input));
        return new Response(JSON.stringify(body));
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );

  return { urls, fetchSpy };
}

describe('weather tools', () => {
  let savedApiKey: string | undefined;

  beforeEach(() => {
    savedApiKey = process.env[API_KEY_ENV];
    process.env[API_KEY_ENV] = 'test-key';
  });

  afterEach(() => {
    if (savedApiKey === undefined) {
      delete process.env[API_KEY_ENV];
    } else {
      process.env[API_KEY_ENV] = savedApiKey;
    }
  });

  it('reads the current weather for a city', async () => {
    const { urls, fetchSpy } = fakeOpenWeatherMap({ ...conditions, name: 'Aarhus', coord: { lat: 56.16, lon: 10.2 } });

    const weather = await executeTool(getCurrentWeatherByCity, { cityName: 'aarhus,dk' });

    expect(urls[0]).toContain('/data/2.5/weather?q=aarhus%2Cdk&');
    expect(weather).toEqual({
      temperature: 12.3,
      feelsLike: 10.1,
      tempMin: 9.8,
      tempMax: 13,
      humidity: 80,
      pressure: 1012,
      windSpeed: 5.1,
      windDirection: 240,
      windGust: 9,
      cloudiness: 75,
      condition: 'Rain',
      description: 'light rain',
      location: 'Aarhus',
      coordinates: { lat: 56.16, lon: 10.2 },
    });
    fetchSpy.mockRestore();
  });

  it('reads a forecast for coordinates, one entry per time slot', async () => {
    const { urls, fetchSpy } = fakeOpenWeatherMap({
      city: { name: 'Aarhus', coord: { lat: 56.16, lon: 10.2 } },
      list: [
        { ...conditions, dt_txt: '2026-09-26 12:00:00' },
        { ...conditions, dt_txt: '2026-09-26 15:00:00' },
      ],
    });

    const forecast = await executeTool(getForecastByCoordinates, { latitude: 56.16, longitude: 10.2 });

    expect(urls[0]).toContain('/data/2.5/forecast?lat=56.16&lon=10.2&');
    expect(forecast.location).toBe('Aarhus');
    expect(forecast.forecast.map((entry) => entry.datetime)).toEqual(['2026-09-26 12:00:00', '2026-09-26 15:00:00']);
    expect(forecast.forecast[0].description).toBe('light rain');
    fetchSpy.mockRestore();
  });

  it('describes the current weather in one line, gusts only when there are any', () => {
    const weather = {
      temperature: 12.3,
      feelsLike: 10.1,
      tempMin: 9.8,
      tempMax: 13,
      humidity: 80,
      pressure: 1012,
      windSpeed: 5.1,
      windDirection: 240,
      windGust: 9,
      cloudiness: 75,
      condition: 'Rain',
      description: 'light rain',
      location: 'Aarhus',
      coordinates: { lat: 56.16, lon: 10.2 },
    };

    expect(describeCurrentWeather(weather)).toBe(
      'Aarhus: 12.3°C (feels like 10.1°C, 9.8–13°C), light rain. Humidity 80%, wind 5.1 m/s (gusts 9 m/s) from 240°, cloud cover 75%, pressure 1012 hPa.',
    );
    expect(describeCurrentWeather({ ...weather, windGust: undefined })).toContain('wind 5.1 m/s from 240°');
  });
});
