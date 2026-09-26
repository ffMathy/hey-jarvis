import { z } from 'zod';
import { createTool } from '../../utils/tool-factory.js';

// The parts of OpenWeatherMap's responses the tools read. Parsed rather than cast, so a response
// that lacks one of them fails here, with its field named, instead of somewhere downstream.
const conditionsSchema = z.object({
  main: z.object({
    temp: z.number(),
    feels_like: z.number(),
    temp_min: z.number(),
    temp_max: z.number(),
    pressure: z.number(),
    humidity: z.number(),
  }),
  wind: z.object({
    speed: z.number(),
    deg: z.number(),
    gust: z.number().optional(),
  }),
  clouds: z.object({
    all: z.number(),
  }),
  weather: z
    .array(
      z.object({
        main: z.string(),
        description: z.string(),
      }),
    )
    .min(1),
});

const coordinatesResponseSchema = z.object({ lat: z.number(), lon: z.number() });

const currentWeatherResponseSchema = conditionsSchema.extend({
  name: z.string(),
  coord: coordinatesResponseSchema,
});

const forecastResponseSchema = z.object({
  city: z.object({
    name: z.string(),
    coord: coordinatesResponseSchema,
  }),
  list: z.array(conditionsSchema.extend({ dt_txt: z.string() })),
});

const conditionsOutputSchema = z.object({
  temperature: z.number(),
  feelsLike: z.number(),
  tempMin: z.number(),
  tempMax: z.number(),
  humidity: z.number(),
  pressure: z.number(),
  windSpeed: z.number(),
  windDirection: z.number(),
  windGust: z.number().optional(),
  cloudiness: z.number(),
  condition: z.string(),
  description: z.string(),
});

const coordinatesOutputSchema = z.object({
  lat: z.number(),
  lon: z.number(),
});

/** What the current-weather tools return. */
const currentWeatherSchema = conditionsOutputSchema.extend({
  location: z.string(),
  coordinates: coordinatesOutputSchema,
});

export type CurrentWeather = z.infer<typeof currentWeatherSchema>;

/** What the forecast tools return. */
const forecastSchema = z.object({
  location: z.string(),
  coordinates: coordinatesOutputSchema,
  forecast: z.array(conditionsOutputSchema.extend({ datetime: z.string() })),
});

const cityNameInputSchema = z.object({
  cityName: z
    .string()
    .describe(
      'The city name in format "city,country" (e.g., "berlin,de" for Berlin in Germany or "aarhus,dk" for Mathias\' location in Denmark)',
    ),
});

const coordinatesInputSchema = z.object({
  latitude: z.number().describe('Latitude coordinate'),
  longitude: z.number().describe('Longitude coordinate'),
});

// Get OpenWeatherMap API key from environment
const getApiKey = () => {
  const apiKey = process.env.HEY_JARVIS_OPENWEATHERMAP_API_KEY;
  if (!apiKey) {
    throw new Error('OpenWeatherMap API key not found. Please set OPENWEATHERMAP_API_KEY environment variable.');
  }
  return apiKey;
};

/** The query string that picks a location, by city name or by coordinates. */
function byCity({ cityName }: z.infer<typeof cityNameInputSchema>): string {
  return `q=${encodeURIComponent(cityName)}`;
}

function byCoordinates({ latitude, longitude }: z.infer<typeof coordinatesInputSchema>): string {
  return `lat=${latitude}&lon=${longitude}`;
}

async function fetchOpenWeatherMap(endpoint: 'weather' | 'forecast', locationQuery: string): Promise<unknown> {
  const url = `https://api.openweathermap.org/data/2.5/${endpoint}?${locationQuery}&appid=${getApiKey()}&units=metric&lang=en`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${endpoint} data: ${response.statusText}`);
  }

  return await response.json();
}

function toConditions(conditions: z.infer<typeof conditionsSchema>): z.infer<typeof conditionsOutputSchema> {
  return {
    temperature: conditions.main.temp,
    feelsLike: conditions.main.feels_like,
    tempMin: conditions.main.temp_min,
    tempMax: conditions.main.temp_max,
    humidity: conditions.main.humidity,
    pressure: conditions.main.pressure,
    windSpeed: conditions.wind.speed,
    windDirection: conditions.wind.deg,
    windGust: conditions.wind.gust,
    cloudiness: conditions.clouds.all,
    condition: conditions.weather[0].main,
    description: conditions.weather[0].description,
  };
}

async function fetchCurrentWeather(locationQuery: string): Promise<CurrentWeather> {
  const data = currentWeatherResponseSchema.parse(await fetchOpenWeatherMap('weather', locationQuery));

  return {
    ...toConditions(data),
    location: data.name,
    coordinates: {
      lat: data.coord.lat,
      lon: data.coord.lon,
    },
  };
}

async function fetchForecast(locationQuery: string): Promise<z.infer<typeof forecastSchema>> {
  const data = forecastResponseSchema.parse(await fetchOpenWeatherMap('forecast', locationQuery));

  return {
    location: data.city.name,
    coordinates: {
      lat: data.city.coord.lat,
      lon: data.city.coord.lon,
    },
    forecast: data.list.map((item) => ({ datetime: item.dt_txt, ...toConditions(item) })),
  };
}

// Tool to get current weather by city name
export const getCurrentWeatherByCity = createTool({
  id: 'getCurrentWeatherByCity',
  description: 'Get current weather information for a specific city',
  inputSchema: cityNameInputSchema,
  outputSchema: currentWeatherSchema,
  execute: async (inputData) => await fetchCurrentWeather(byCity(inputData)),
});

// Tool to get current weather by GPS coordinates
export const getCurrentWeatherByCoordinates = createTool({
  id: 'getCurrentWeatherByCoordinates',
  description: 'Get current weather information for specific GPS coordinates',
  inputSchema: coordinatesInputSchema,
  outputSchema: currentWeatherSchema,
  execute: async (inputData) => await fetchCurrentWeather(byCoordinates(inputData)),
});

// Tool to get 5-day forecast by city name
export const getForecastByCity = createTool({
  id: 'getForecastByCity',
  description: 'Get 5-day weather forecast for a specific city',
  inputSchema: cityNameInputSchema,
  outputSchema: forecastSchema,
  execute: async (inputData) => await fetchForecast(byCity(inputData)),
});

// Tool to get 5-day forecast by GPS coordinates
export const getForecastByCoordinates = createTool({
  id: 'getForecastByCoordinates',
  description: 'Get 5-day weather forecast for specific GPS coordinates',
  inputSchema: coordinatesInputSchema,
  outputSchema: forecastSchema,
  execute: async (inputData) => await fetchForecast(byCoordinates(inputData)),
});

// Export all tools together for convenience
export const weatherTools = {
  getCurrentWeatherByCity,
  getCurrentWeatherByCoordinates,
  getForecastByCity,
  getForecastByCoordinates,
};
