import { beforeAll, describe, expect, it } from 'bun:test';
import { isValidationError } from '../../utils/test-helpers/validation-error.js';
import { getAllDevices, getAllServices } from './tools';

describe('IoT Tools Integration Tests', () => {
  beforeAll(() => {
    // These tools require Home Assistant configuration
    // In production (addon): SUPERVISOR_TOKEN is used and converted to HEY_JARVIS_HOME_ASSISTANT_* by run.sh
    // In tests: HEY_JARVIS_HOME_ASSISTANT_URL and HEY_JARVIS_HOME_ASSISTANT_TOKEN are used directly
    const hasHomeAssistantConfig =
      process.env.HEY_JARVIS_HOME_ASSISTANT_URL && process.env.HEY_JARVIS_HOME_ASSISTANT_TOKEN;

    if (!hasHomeAssistantConfig) {
      throw new Error(
        'Home Assistant configuration is required for IoT tools tests. Set HEY_JARVIS_HOME_ASSISTANT_URL and HEY_JARVIS_HOME_ASSISTANT_TOKEN environment variables.',
      );
    }
  });

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
      expect(Array.isArray(result.services)).toBe(true);

      console.log('✅ Services retrieved from Home Assistant');
      console.log('   - Service count:', result.services.length);
    }, 30000);
  });
});
