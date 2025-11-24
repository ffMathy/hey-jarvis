// @ts-expect-error - bun:test types are built into Bun runtime
import { beforeAll, describe, expect, it } from 'bun:test';
import { weatherTools } from './tools';

// Type guard to check if result is a validation error
function isValidationError(result: any): result is { error: true; message: string } {
  return result && result.error === true;
}

describe('Weather Tools Integration Tests', () => {
  beforeAll(() => {
    // Verify API key is configured
    if (!process.env.HEY_JARVIS_OPENWEATHERMAP_API_KEY) {
      throw new Error('HEY_JARVIS_OPENWEATHERMAP_API_KEY environment variable is required for weather tools tests');
    }
  });

  describe('getCurrentWeatherByCity', () => {
    it('should fetch current weather for a city', async () => {
      const result = await weatherTools.getCurrentWeatherByCity.execute({
        cityName: 'aarhus,dk',
      });

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      // Validate structure
      expect(result).toBeDefined();
      expect(typeof result.temperature).toBe('number');
      expect(typeof result.feelsLike).toBe('number');
      expect(typeof result.tempMin).toBe('number');
      expect(typeof result.tempMax).toBe('number');
      expect(typeof result.humidity).toBe('number');
      expect(typeof result.pressure).toBe('number');
      expect(typeof result.windSpeed).toBe('number');
      expect(typeof result.windDirection).toBe('number');
      expect(typeof result.cloudiness).toBe('number');
      expect(typeof result.condition).toBe('string');
      expect(typeof result.description).toBe('string');
      expect(typeof result.location).toBe('string');
      expect(result.coordinates).toBeDefined();
      expect(typeof result.coordinates.lat).toBe('number');
      expect(typeof result.coordinates.lon).toBe('number');

      // Validate reasonable ranges
      expect(result.temperature).toBeGreaterThan(-50);
      expect(result.temperature).toBeLessThan(60);
      expect(result.humidity).toBeGreaterThanOrEqual(0);
      expect(result.humidity).toBeLessThanOrEqual(100);
      expect(result.cloudiness).toBeGreaterThanOrEqual(0);
      expect(result.cloudiness).toBeLessThanOrEqual(100);

      console.log('✅ Current weather fetched successfully for:', result.location);
      console.log('   - Temperature:', result.temperature, '°C');
      console.log('   - Condition:', result.condition, '-', result.description);
      console.log('   - Humidity:', result.humidity, '%');
    }, 30000);

    it('should handle invalid city gracefully', async () => {
      await expect(async () => {
        const result = await weatherTools.getCurrentWeatherByCity.execute({
          cityName: 'thiscitydoesnotexist123456',
        });
        if (isValidationError(result)) {
          throw new Error(result.message);
        }
      }).toThrow();
    }, 30000);
  });

  describe('getCurrentWeatherByCoordinates', () => {
    it('should fetch current weather for GPS coordinates', async () => {
      // Coordinates for Aarhus, Denmark
      const result = await weatherTools.getCurrentWeatherByCoordinates.execute({
        latitude: 56.1629,
        longitude: 10.2039,
      });

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      // Validate structure
      expect(result).toBeDefined();
      expect(typeof result.temperature).toBe('number');
      expect(typeof result.feelsLike).toBe('number');
      expect(typeof result.tempMin).toBe('number');
      expect(typeof result.tempMax).toBe('number');
      expect(typeof result.humidity).toBe('number');
      expect(typeof result.pressure).toBe('number');
      expect(typeof result.windSpeed).toBe('number');
      expect(typeof result.windDirection).toBe('number');
      expect(typeof result.cloudiness).toBe('number');
      expect(typeof result.condition).toBe('string');
      expect(typeof result.description).toBe('string');
      expect(typeof result.location).toBe('string');
      expect(result.coordinates).toBeDefined();
      expect(typeof result.coordinates.lat).toBe('number');
      expect(typeof result.coordinates.lon).toBe('number');

      // Validate coordinates match input (approximately)
      expect(result.coordinates.lat).toBeCloseTo(56.1629, 1);
      expect(result.coordinates.lon).toBeCloseTo(10.2039, 1);

      console.log('✅ Current weather fetched successfully for coordinates:', result.location);
      console.log('   - Temperature:', result.temperature, '°C');
      console.log('   - Condition:', result.condition, '-', result.description);
    }, 30000);
  });

  describe('getForecastByCity', () => {
    it('should fetch 5-day forecast for a city', async () => {
      const result = await weatherTools.getForecastByCity.execute({
        cityName: 'aarhus,dk',
      });

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      // Validate structure
      expect(result).toBeDefined();
      expect(typeof result.location).toBe('string');
      expect(result.coordinates).toBeDefined();
      expect(typeof result.coordinates.lat).toBe('number');
      expect(typeof result.coordinates.lon).toBe('number');
      expect(Array.isArray(result.forecast)).toBe(true);
      expect(result.forecast.length).toBeGreaterThan(0);

      // Validate first forecast entry
      const firstEntry = result.forecast[0];
      expect(typeof firstEntry.datetime).toBe('string');
      expect(typeof firstEntry.temperature).toBe('number');
      expect(typeof firstEntry.feelsLike).toBe('number');
      expect(typeof firstEntry.tempMin).toBe('number');
      expect(typeof firstEntry.tempMax).toBe('number');
      expect(typeof firstEntry.humidity).toBe('number');
      expect(typeof firstEntry.pressure).toBe('number');
      expect(typeof firstEntry.windSpeed).toBe('number');
      expect(typeof firstEntry.windDirection).toBe('number');
      expect(typeof firstEntry.cloudiness).toBe('number');
      expect(typeof firstEntry.condition).toBe('string');
      expect(typeof firstEntry.description).toBe('string');

      console.log('✅ 5-day forecast fetched successfully for:', result.location);
      console.log('   - Forecast entries:', result.forecast.length);
      console.log('   - First entry:', firstEntry.datetime);
      console.log('     Temperature:', firstEntry.temperature, '°C');
      console.log('     Condition:', firstEntry.condition, '-', firstEntry.description);
    }, 30000);
  });

  describe('getForecastByCoordinates', () => {
    it('should fetch 5-day forecast for GPS coordinates', async () => {
      // Coordinates for Aarhus, Denmark
      const result = await weatherTools.getForecastByCoordinates.execute({
        latitude: 56.1629,
        longitude: 10.2039,
      });

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      // Validate structure
      expect(result).toBeDefined();
      expect(typeof result.location).toBe('string');
      expect(result.coordinates).toBeDefined();
      expect(typeof result.coordinates.lat).toBe('number');
      expect(typeof result.coordinates.lon).toBe('number');
      expect(Array.isArray(result.forecast)).toBe(true);
      expect(result.forecast.length).toBeGreaterThan(0);

      // Validate coordinates match input (approximately)
      expect(result.coordinates.lat).toBeCloseTo(56.1629, 1);
      expect(result.coordinates.lon).toBeCloseTo(10.2039, 1);

      // Validate forecast entries
      const firstEntry = result.forecast[0];
      expect(typeof firstEntry.datetime).toBe('string');
      expect(typeof firstEntry.temperature).toBe('number');
      expect(typeof firstEntry.condition).toBe('string');

      console.log('✅ 5-day forecast fetched successfully for coordinates:', result.location);
      console.log('   - Forecast entries:', result.forecast.length);
      console.log('   - First entry:', firstEntry.datetime);
    }, 30000);
  });
});
