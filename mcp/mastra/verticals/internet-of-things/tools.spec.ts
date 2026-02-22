import { beforeAll, describe, expect, it } from 'bun:test';
import { isValidationError } from '../../utils/test-helpers/validation-error.js';
import { fetchHistoricalStates, getAllDevices, getAllServices } from './tools';

// These tests require a Cloudflared tunnel URL in HEY_JARVIS_HOME_ASSISTANT_URL
// so they can run from anywhere (CI, devcontainers, etc.) — never skip them.

describe('IoT Tools Integration Tests', () => {
  describe('getAllDevices', () => {
    it('should retrieve all devices from Home Assistant', async () => {
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
    }, 30000);
  });

  describe('getAllServices', () => {
    it('should retrieve all services from Home Assistant', async () => {
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
    }, 30000);
  });

  describe('fetchHistoricalStates', () => {
    // Home Assistant requires entity_id filters for history queries.
    // Resolve a known entity ID in beforeAll so all tests can use it.
    let entityId: string;

    beforeAll(async () => {
      const devicesResult = await getAllDevices.execute({});
      if (isValidationError(devicesResult)) {
        throw new Error(`Validation failed: ${devicesResult.message}`);
      }
      expect(devicesResult.devices.length).toBeGreaterThan(0);

      const firstDevice = devicesResult.devices[0];
      expect(firstDevice.entities?.length).toBeGreaterThan(0);
      entityId = firstDevice.entities![0].id;
    }, 30000);

    it('should fetch historical states with explicit time range', async () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const now = new Date().toISOString();

      const result = await fetchHistoricalStates({
        entityIds: [entityId],
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
    }, 30000);

    it('should use default time range when not specified', async () => {
      const result = await fetchHistoricalStates({
        entityIds: [entityId],
      });

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
    }, 30000);

    it('should filter by specific entity IDs', async () => {
      const result = await fetchHistoricalStates({
        entityIds: [entityId],
        minimalResponse: true,
      });

      // Validate structure
      expect(result).toBeDefined();
      expect(result.history).toBeDefined();

      // History should only be for the requested entity
      if (result.entityCount > 0) {
        expect(result.entityCount).toBeLessThanOrEqual(1);
        expect(result.history[entityId]).toBeDefined();
      }

      console.log('✅ Historical states filtered by entity ID');
      console.log('   - Requested entity:', entityId);
      console.log('   - Entity count:', result.entityCount);
    }, 30000);
  });
});
