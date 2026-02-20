import { beforeAll, describe, expect, it } from 'bun:test';
import { isValidationError } from '../../utils/test-helpers/validation-error.js';
import { fetchHistoricalStates, getAllDevices, getAllServices } from './tools';

describe('IoT Tools Integration Tests', () => {
  // Check if Home Assistant is available
  // In production (addon): SUPERVISOR_TOKEN is used and converted to HEY_JARVIS_HOME_ASSISTANT_* by run.sh
  // In tests: HEY_JARVIS_HOME_ASSISTANT_URL and HEY_JARVIS_HOME_ASSISTANT_TOKEN are used directly
  const hasHomeAssistantConfig =
    process.env.HEY_JARVIS_HOME_ASSISTANT_URL && process.env.HEY_JARVIS_HOME_ASSISTANT_TOKEN;

  describe('getAllDevices', () => {
    it('should retrieve all devices from Home Assistant', async () => {
      if (!hasHomeAssistantConfig) {
        console.log('⚠️ Skipping test: Home Assistant configuration not available');
        return;
      }

      try {
        const result = await getAllDevices.execute({});

        // Check for validation errors
        if (isValidationError(result)) {
          throw new Error(`Validation failed: ${result.message}`);
        }

        // Validate structure
        expect(result).toBeDefined();
        expect(Array.isArray(result.devices)).toBe(true);

        console.log('✅ Devices retrieved from Home Assistant');
        console.log('   - Device count:', result.devices.length);
      } catch (error) {
        // Connection errors are expected when Home Assistant is not accessible
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          (error.code === 'ConnectionRefused' || error.code === 'FailedToOpenSocket')
        ) {
          console.log('⚠️ Skipping test: Home Assistant is not accessible');
          return;
        }
        throw error;
      }
    }, 30000);
  });

  describe('getAllServices', () => {
    it('should retrieve all services from Home Assistant', async () => {
      if (!hasHomeAssistantConfig) {
        console.log('⚠️ Skipping test: Home Assistant configuration not available');
        return;
      }

      try {
        const result = await getAllServices.execute({});

        // Check for validation errors
        if (isValidationError(result)) {
          throw new Error(`Validation failed: ${result.message}`);
        }

        // Validate structure
        expect(result).toBeDefined();
        expect(result.services_by_domain).toBeDefined();
        expect(typeof result.services_by_domain).toBe('object');

        console.log('✅ Services retrieved from Home Assistant');
        console.log('   - Domain count:', Object.keys(result.services_by_domain).length);
      } catch (error) {
        // Connection errors are expected when Home Assistant is not accessible
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          (error.code === 'ConnectionRefused' || error.code === 'FailedToOpenSocket')
        ) {
          console.log('⚠️ Skipping test: Home Assistant is not accessible');
          return;
        }
        throw error;
      }
    }, 30000);
  });

  describe('fetchHistoricalStates', () => {
    it('should fetch historical states from Home Assistant', async () => {
      if (!hasHomeAssistantConfig) {
        console.log('⚠️ Skipping test: Home Assistant configuration not available');
        return;
      }

      try {
        // Fetch last 5 minutes of history
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const now = new Date().toISOString();

        const result = await fetchHistoricalStates({
          startTime: fiveMinutesAgo,
          endTime: now,
          minimalResponse: true,
        });

        // Validate structure
        expect(result).toBeDefined();
        expect(result.history).toBeDefined();
        expect(typeof result.history).toBe('object');
        expect(result.startTime).toBe(fiveMinutesAgo);
        expect(result.endTime).toBe(now);
        expect(typeof result.entityCount).toBe('number');

        console.log('✅ Historical states retrieved from Home Assistant');
        console.log('   - Entity count:', result.entityCount);
        console.log('   - Time range:', fiveMinutesAgo, 'to', now);
      } catch (error) {
        // Connection errors are expected when Home Assistant is not accessible
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          (error.code === 'ConnectionRefused' || error.code === 'FailedToOpenSocket')
        ) {
          console.log('⚠️ Skipping test: Home Assistant is not accessible');
          return;
        }
        // Some HA installations reject unfiltered history queries
        if (error instanceof Error && error.message.includes('Bad Request')) {
          console.log('⚠️ Skipping test: Home Assistant rejected unfiltered history query (Bad Request)');
          return;
        }
        throw error;
      }
    }, 30000);

    it('should use default time range when not specified', async () => {
      if (!hasHomeAssistantConfig) {
        console.log('⚠️ Skipping test: Home Assistant configuration not available');
        return;
      }

      try {
        const result = await fetchHistoricalStates();

        // Validate structure
        expect(result).toBeDefined();
        expect(result.history).toBeDefined();
        expect(typeof result.history).toBe('object');
        expect(result.startTime).toBeDefined();
        expect(result.endTime).toBeDefined();
        expect(typeof result.entityCount).toBe('number');

        // Verify default time range is approximately 15 minutes
        const startDate = new Date(result.startTime);
        const endDate = new Date(result.endTime);
        const diffMinutes = (endDate.getTime() - startDate.getTime()) / (1000 * 60);

        expect(diffMinutes).toBeGreaterThanOrEqual(14);
        expect(diffMinutes).toBeLessThanOrEqual(16);

        console.log('✅ Historical states retrieved with default time range');
        console.log('   - Entity count:', result.entityCount);
        console.log('   - Time range (minutes):', diffMinutes.toFixed(1));
      } catch (error) {
        // Connection errors are expected when Home Assistant is not accessible
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          (error.code === 'ConnectionRefused' || error.code === 'FailedToOpenSocket')
        ) {
          console.log('⚠️ Skipping test: Home Assistant is not accessible');
          return;
        }
        // Some HA installations reject unfiltered history queries
        if (error instanceof Error && error.message.includes('Bad Request')) {
          console.log('⚠️ Skipping test: Home Assistant rejected unfiltered history query (Bad Request)');
          return;
        }
        throw error;
      }
    }, 30000);

    it('should filter by specific entity IDs', async () => {
      if (!hasHomeAssistantConfig) {
        console.log('⚠️ Skipping test: Home Assistant configuration not available');
        return;
      }

      try {
        // First get all devices to find a valid entity ID
        const devicesResult = await getAllDevices.execute({});
        if (isValidationError(devicesResult) || devicesResult.devices.length === 0) {
          console.log('⚠️ Skipping test: No devices available');
          return;
        }

        // Get first entity ID
        const firstDevice = devicesResult.devices[0];
        if (!firstDevice.entities || firstDevice.entities.length === 0) {
          console.log('⚠️ Skipping test: No entities available');
          return;
        }

        const entityId = firstDevice.entities[0].id;

        // Fetch history for specific entity
        const result = await fetchHistoricalStates({
          entityIds: [entityId],
          minimalResponse: true,
        });

        // Validate structure
        expect(result).toBeDefined();
        expect(result.history).toBeDefined();

        // If there's history, it should only be for the requested entity
        if (result.entityCount > 0) {
          expect(result.entityCount).toBeLessThanOrEqual(1);
          expect(result.history[entityId]).toBeDefined();
        }

        console.log('✅ Historical states filtered by entity ID');
        console.log('   - Requested entity:', entityId);
        console.log('   - Entity count:', result.entityCount);
      } catch (error) {
        // Connection errors are expected when Home Assistant is not accessible
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          (error.code === 'ConnectionRefused' || error.code === 'FailedToOpenSocket')
        ) {
          console.log('⚠️ Skipping test: Home Assistant is not accessible');
          return;
        }
        throw error;
      }
    }, 30000);
  });
});
