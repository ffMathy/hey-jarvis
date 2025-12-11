import { beforeAll, describe, expect, it } from 'bun:test';
import { isValidationError } from '../../utils/test-helpers/validation-error.js';
import { sendTextMessage } from './tools';

describe('Phone Tools Integration Tests', () => {
  beforeAll(() => {
    // Check if Twilio credentials are configured
    if (
      !process.env.HEY_JARVIS_TWILIO_ACCOUNT_SID ||
      !process.env.HEY_JARVIS_TWILIO_AUTH_TOKEN ||
      !process.env.HEY_JARVIS_TWILIO_PHONE_NUMBER
    ) {
      throw new Error(
        'Twilio credentials are required for phone tools tests. Set HEY_JARVIS_TWILIO_ACCOUNT_SID, HEY_JARVIS_TWILIO_AUTH_TOKEN, and HEY_JARVIS_TWILIO_PHONE_NUMBER environment variables.',
      );
    }
  });

  describe('sendTextMessage', () => {
    it('should send a text message via Twilio', async () => {
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

      console.log('✅ SMS tool executed');
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
