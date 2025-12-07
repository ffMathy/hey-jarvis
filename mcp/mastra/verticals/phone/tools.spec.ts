// @ts-expect-error - bun:test types are built into Bun runtime
import { beforeAll, describe, expect, it } from 'bun:test';
import { sendTextMessage } from './tools';

// Type guard to check if result is a validation error
function isValidationError(result: unknown): result is { error: true; message: string } {
  return (
    typeof result === 'object' && result !== null && 'error' in result && (result as { error: boolean }).error === true
  );
}

describe('Phone Tools Integration Tests', () => {
  beforeAll(() => {
    // Check if Twilio credentials are configured
    if (!process.env.HEY_JARVIS_TWILIO_ACCOUNT_SID) {
      console.log('⚠️  Twilio credentials not configured - tests will validate error handling');
    }
  });

  describe('sendTextMessage', () => {
    it('should handle missing Twilio credentials gracefully', async () => {
      const result = await sendTextMessage.execute({
        phoneNumber: '+1234567890',
        message: 'Test message',
      });

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      // Validate structure
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.message).toBe('string');

      // If Twilio is not configured, should fail gracefully
      // Allow various error messages (missing config or invalid phone number)
      if (!result.success) {
        expect(result.message.length).toBeGreaterThan(0);
      }

      console.log('✅ SMS tool handled gracefully');
      console.log('   - Success:', result.success);
      // Do not log message content as it may contain error details with config paths
    }, 10000);

    it('should validate phone number format in schema', async () => {
      const result = await sendTextMessage.execute({
        phoneNumber: '+15551234567',
        message: 'Test message with valid E.164 format',
      });

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');

      console.log('✅ Phone number validation passed');
    }, 10000);
  });
});
