import { describe, expect, it } from 'bun:test';
import { sendTextMessage } from './tools';

// These tests exercise the sendTextMessage input contract only — they make no
// Twilio calls, so they need no credentials and send no SMS. Sending a real
// message from CI is not viable: Twilio rejects any placeholder number with
// error 21211, and a genuine number would be texted on every single run.
describe('Phone Tools', () => {
  const inputSchema = sendTextMessage.inputSchema;

  describe('sendTextMessage input schema', () => {
    it('accepts an E.164 number with a message', () => {
      const parsed = inputSchema.parse({
        phoneNumber: '+15551234567',
        message: 'Test message',
      });

      expect(parsed.phoneNumber).toBe('+15551234567');
      expect(parsed.message).toBe('Test message');
    });

    it('rejects input with no phone number', () => {
      expect(() => inputSchema.parse({ message: 'Test message' })).toThrow();
    });

    it('rejects input with no message', () => {
      expect(() => inputSchema.parse({ phoneNumber: '+15551234567' })).toThrow();
    });

    it('rejects a non-string phone number', () => {
      expect(() => inputSchema.parse({ phoneNumber: 15551234567, message: 'Test message' })).toThrow();
    });

    it('rejects a non-string message', () => {
      expect(() => inputSchema.parse({ phoneNumber: '+15551234567', message: 42 })).toThrow();
    });
  });

  describe('sendTextMessage definition', () => {
    it('is registered under a stable tool id', () => {
      expect(sendTextMessage.id).toBe('sendTextMessage');
    });

    it('declares the result shape callers depend on', () => {
      const parsed = sendTextMessage.outputSchema.parse({
        success: true,
        message: 'Text message sent successfully to +15551234567',
        messageSid: 'SM00000000000000000000000000000000',
      });

      expect(parsed.success).toBe(true);
      expect(parsed.messageSid).toBeDefined();
    });

    it('treats messageSid as optional, since a failed send has none', () => {
      const parsed = sendTextMessage.outputSchema.parse({
        success: false,
        message: 'Could not send',
      });

      expect(parsed.messageSid).toBeUndefined();
    });
  });
});
