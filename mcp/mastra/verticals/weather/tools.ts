import { z } from 'zod';
import { createTool } from '../../utils/tool-factory';

// Interface for OpenWeatherMap current weather response
interface CurrentWeatherResponse {
    weather: Array<{
        main: string;
        description: string;
        icon: string;
    }>;
    main: {
        temp: number;
        feels_like: number;
        temp_min: number;
        temp_max: number;
        pressure: number;
        humidity: number;
    };
    wind: {
        speed: number;
        deg: number;
        gust?: number;
    };
    clouds: {
        all: number;
    };
    name: string;
    coord: {
        lat: number;
        lon: number;
    };
}

// Interface for OpenWeatherMap 5-day forecast response
interface ForecastResponse {
    city: {
        name: string;
        coord: {
            lat: number;
            lon: number;
        };
    };
    list: Array<{
        dt_txt: string;
        main: {
            temp: number;
            feels_like: number;
            temp_min: number;
            temp_max: number;
            pressure: number;
            humidity: number;
        };
        wind: {
            speed: number;
            deg: number;
            gust?: number;
        };
        clouds: {
            all: number;
        };
        weather: Array<{
            main: string;
            description: string;
        }>;
    }>;
}

// Get OpenWeatherMap API key from environment
const getApiKey = () => {
    const apiKey = process.env.HEY_JARVIS_OPENWEATHERMAP_API_KEY;
    if (!apiKey) {
        throw new Error('OpenWeatherMap API key not found. Please set OPENWEATHERMAP_API_KEY environment variable.');
    }
    return apiKey;
};

// Tool to get current weather by city name
export const getCurrentWeatherByCity = createTool({
    id: 'get-current-weather-by-city',
    description: 'Get current weather information for a specific city',
    inputSchema: z.object({
        cityName: z.string().describe('The city name in format "city,country" (e.g., "berlin,de" for Berlin in Germany or "aarhus,dk" for Mathias in Denmark)'),
    }),
    outputSchema: z.object({
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
        location: z.string(),
        coordinates: z.object({
            lat: z.number(),
            lon: z.number(),
        }),
    }),
    execute: async ({ context }) => {
        const apiKey = getApiKey();
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(context.cityName)}&appid=${apiKey}&units=metric&lang=en`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch weather data: ${response.statusText}`);
        }

        const data = (await response.json()) as CurrentWeatherResponse;

        return {
            temperature: data.main.temp,
            feelsLike: data.main.feels_like,
            tempMin: data.main.temp_min,
            tempMax: data.main.temp_max,
            humidity: data.main.humidity,
            pressure: data.main.pressure,
            windSpeed: data.wind.speed,
            windDirection: data.wind.deg,
            windGust: data.wind.gust,
            cloudiness: data.clouds.all,
            condition: data.weather[0].main,
            description: data.weather[0].description,
            location: data.name,
            coordinates: {
                lat: data.coord.lat,
                lon: data.coord.lon,
            },
        };
    },
});

// Tool to get current weather by GPS coordinates
export const getCurrentWeatherByCoordinates = createTool({
    id: 'get-current-weather-by-coordinates',
    description: 'Get current weather information for specific GPS coordinates',
    inputSchema: z.object({
        latitude: z.number().describe('Latitude coordinate'),
        longitude: z.number().describe('Longitude coordinate'),
    }),
    outputSchema: z.object({
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
        location: z.string(),
        coordinates: z.object({
            lat: z.number(),
            lon: z.number(),
        }),
    }),
    execute: async ({ context }) => {
        const apiKey = getApiKey();
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${context.latitude}&lon=${context.longitude}&appid=${apiKey}&units=metric&lang=en`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch weather data: ${response.statusText}`);
        }

        const data = (await response.json()) as CurrentWeatherResponse;

        return {
            temperature: data.main.temp,
            feelsLike: data.main.feels_like,
            tempMin: data.main.temp_min,
            tempMax: data.main.temp_max,
            humidity: data.main.humidity,
            pressure: data.main.pressure,
            windSpeed: data.wind.speed,
            windDirection: data.wind.deg,
            windGust: data.wind.gust,
            cloudiness: data.clouds.all,
            condition: data.weather[0].main,
            description: data.weather[0].description,
            location: data.name,
            coordinates: {
                lat: data.coord.lat,
                lon: data.coord.lon,
            },
        };
    },
});

// Tool to get 5-day forecast by city name
export const getForecastByCity = createTool({
    id: 'get-forecast-by-city',
    description: 'Get 5-day weather forecast for a specific city',
    inputSchema: z.object({
        cityName: z.string().describe('The city name in format "city,country" (e.g., "berlin,de" for Berlin in Germany or "aarhus,dk" for Mathias in Denmark)'),
    }),
    outputSchema: z.object({
        location: z.string(),
        coordinates: z.object({
            lat: z.number(),
            lon: z.number(),
        }),
        forecast: z.array(z.object({
            datetime: z.string(),
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
        })),
    }),
    execute: async ({ context }) => {
        const apiKey = getApiKey();
        const url = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(context.cityName)}&appid=${apiKey}&units=metric&lang=en`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch forecast data: ${response.statusText}`);
        }

        const data = (await response.json()) as ForecastResponse;

        return {
            location: data.city.name,
            coordinates: {
                lat: data.city.coord.lat,
                lon: data.city.coord.lon,
            },
            forecast: data.list.map(item => ({
                datetime: item.dt_txt,
                temperature: item.main.temp,
                feelsLike: item.main.feels_like,
                tempMin: item.main.temp_min,
                tempMax: item.main.temp_max,
                humidity: item.main.humidity,
                pressure: item.main.pressure,
                windSpeed: item.wind.speed,
                windDirection: item.wind.deg,
                windGust: item.wind.gust,
                cloudiness: item.clouds.all,
                condition: item.weather[0].main,
                description: item.weather[0].description,
            })),
        };
    },
});

// Tool to get 5-day forecast by GPS coordinates
export const getForecastByCoordinates = createTool({
    id: 'get-forecast-by-coordinates',
    description: 'Get 5-day weather forecast for specific GPS coordinates',
    inputSchema: z.object({
        latitude: z.number().describe('Latitude coordinate'),
        longitude: z.number().describe('Longitude coordinate'),
    }),
    outputSchema: z.object({
        location: z.string(),
        coordinates: z.object({
            lat: z.number(),
            lon: z.number(),
        }),
        forecast: z.array(z.object({
            datetime: z.string(),
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
        })),
    }),
    execute: async ({ context }) => {
        const apiKey = getApiKey();
        const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${context.latitude}&lon=${context.longitude}&appid=${apiKey}&units=metric&lang=en`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch forecast data: ${response.statusText}`);
        }

        const data = (await response.json()) as ForecastResponse;

        return {
            location: data.city.name,
            coordinates: {
                lat: data.city.coord.lat,
                lon: data.city.coord.lon,
            },
            forecast: data.list.map(item => ({
                datetime: item.dt_txt,
                temperature: item.main.temp,
                feelsLike: item.main.feels_like,
                tempMin: item.main.temp_min,
                tempMax: item.main.temp_max,
                humidity: item.main.humidity,
                pressure: item.main.pressure,
                windSpeed: item.wind.speed,
                windDirection: item.wind.deg,
                windGust: item.wind.gust,
                cloudiness: item.clouds.all,
                condition: item.weather[0].main,
                description: item.weather[0].description,
            })),
        };
    },
});

// Export all tools together for convenience
export const weatherTools = {
    getCurrentWeatherByCity,
    getCurrentWeatherByCoordinates,
    getForecastByCity,
    getForecastByCoordinates,
};