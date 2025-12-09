import { describe, expect, it } from 'bun:test';
import { notifyDevice } from './tools';

// Type guard to check if result is a validation error
function isValidationError(result: unknown): result is { error: true; message: string } {
  return (
    typeof result === 'object' && result !== null && 'error' in result && (result as { error: boolean }).error === true
  );
}

describe('Notification Tools Integration Tests', () => {
  describe('notifyDevice', () => {
    it('should handle missing Home Assistant configuration gracefully', async () => {
      const result = await notifyDevice.execute({
        message: 'Test notification',
        conversationTimeout: 5000,
      });

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      // Validate structure
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.message).toBe('string');

      // In test environment without Home Assistant, this should fail gracefully
      if (!result.success) {
        expect(result.message).toContain('Home Assistant');
      }

      console.log('✅ Notification tool handled gracefully');
      console.log('   - Success:', result.success);
      console.log('   - Message:', result.message);
    }, 10000);

    it('should validate input schema', async () => {
      const result = await notifyDevice.execute({
        message: 'Test with device name',
        deviceName: 'test_device',
        conversationTimeout: 3000,
      });

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.message).toBe('string');

      console.log('✅ Notification with device name handled');
    }, 10000);
  });
});
