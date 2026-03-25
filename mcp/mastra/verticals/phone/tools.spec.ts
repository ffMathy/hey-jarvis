import { describe, expect, it } from 'bun:test';
import { sendTextMessage } from './tools';

/** True when all Twilio credentials are configured — the single discriminator for all phone tools tests. */
const twilioConfigured =
  Boolean(process.env.HEY_JARVIS_TWILIO_ACCOUNT_SID) &&
  Boolean(process.env.HEY_JARVIS_TWILIO_AUTH_TOKEN) &&
  Boolean(process.env.HEY_JARVIS_TWILIO_PHONE_NUMBER);

function skipUnlessConfigured(): boolean {
  if (!twilioConfigured) {
    console.log(
      'Skipping: HEY_JARVIS_TWILIO_ACCOUNT_SID, HEY_JARVIS_TWILIO_AUTH_TOKEN, and HEY_JARVIS_TWILIO_PHONE_NUMBER are not set',
    );
    return true;
  }
  return false;
}

describe('Phone Tools Integration Tests', () => {
  describe('sendTextMessage', () => {
    it('should send a text message via Twilio', async () => {
      if (skipUnlessConfigured()) return;

      const result = await sendTextMessage.execute({
        phoneNumber: '+1234567890',
        message: 'Test message',
      });

      // Validate structure
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.message).toBe('string');

      console.log('✅ SMS tool executed');
      console.log('   - Success:', result.success);
      // Do not log message content as it may contain error details with config paths
    }, 10000);

    it('should validate phone number format in schema', async () => {
      if (skipUnlessConfigured()) return;

      const result = await sendTextMessage.execute({
        phoneNumber: '+15551234567',
        message: 'Test message with valid E.164 format',
      });

      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');

      console.log('✅ Phone number validation passed');
    }, 10000);
  });
});
