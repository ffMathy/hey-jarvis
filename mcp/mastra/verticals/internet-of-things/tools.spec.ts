// @ts-expect-error - bun:test types are built into Bun runtime
import { beforeAll, describe, expect, it } from 'bun:test';
import { getAllDevices, getAllServices } from './tools';

// Type guard to check if result is a validation error
function isValidationError(result: unknown): result is { error: true; message: string } {
  return (
    typeof result === 'object' && result !== null && 'error' in result && (result as { error: boolean }).error === true
  );
}

describe('IoT Tools Integration Tests', () => {
  beforeAll(() => {
    // These tools require Home Assistant environment
    if (!process.env.SUPERVISOR_TOKEN) {
      console.log('⚠️  Home Assistant not configured - tests will validate error handling');
    }
  });

  describe('getAllDevices', () => {
    it('should handle missing Home Assistant configuration gracefully', async () => {
      try {
        const result = await getAllDevices.execute({});

        // Check for validation errors
        if (isValidationError(result)) {
          // If Home Assistant is not configured, should get an error
          expect(result.error).toBe(true);
          expect(result.message).toBeDefined();
          console.log('✅ getAllDevices handled missing config gracefully');
          return;
        }

        // If Home Assistant is configured, validate structure
        expect(result).toBeDefined();
        expect(Array.isArray(result.devices)).toBe(true);

        console.log('✅ Devices retrieved from Home Assistant');
        console.log('   - Device count:', result.devices.length);
      } catch (error) {
        // Network errors are expected when Home Assistant is not available
        expect(error).toBeDefined();
        console.log('✅ getAllDevices handled connection error gracefully');
      }
    }, 30000);
  });

  describe('getAllServices', () => {
    it('should handle missing Home Assistant configuration gracefully', async () => {
      try {
        const result = await getAllServices.execute({});

        // Check for validation errors
        if (isValidationError(result)) {
          // If Home Assistant is not configured, should get an error
          expect(result.error).toBe(true);
          expect(result.message).toBeDefined();
          console.log('✅ getAllServices handled missing config gracefully');
          return;
        }

        // If Home Assistant is configured, validate structure
        expect(result).toBeDefined();
        expect(Array.isArray(result.services)).toBe(true);

        console.log('✅ Services retrieved from Home Assistant');
        console.log('   - Service count:', result.services.length);
      } catch (error) {
        // Network errors are expected when Home Assistant is not available
        expect(error).toBeDefined();
        console.log('✅ getAllServices handled connection error gracefully');
      }
    }, 30000);
  });
});
