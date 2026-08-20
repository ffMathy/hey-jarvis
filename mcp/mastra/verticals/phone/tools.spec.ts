import { describe, expect, it } from 'bun:test';
import type { StandardSchemaWithJSON } from '@mastra/core/schema';
import { sendTextMessage } from './tools';

const { inputSchema, outputSchema } = sendTextMessage;

// Without both schemas every assertion below would be vacuous, so fail loudly.
if (!inputSchema || !outputSchema) {
  throw new Error('sendTextMessage must declare both an input and an output schema');
}

/**
 * Validates a value against a tool schema, throwing when it does not conform.
 *
 * Mastra exposes tool schemas through the Standard Schema interface, whose
 * `validate` reports failures in its return value rather than throwing. These
 * tests assert on rejection, so failures are turned back into exceptions.
 */
function parseWithSchema<TInput, TOutput>(schema: StandardSchemaWithJSON<TInput, TOutput>, value: unknown): TOutput {
  const result = schema['~standard'].validate(value);

  if (result instanceof Promise) {
    throw new Error('Schema validated asynchronously, so its result cannot be asserted on synchronously');
  }

  if (result.issues) {
    throw new Error(result.issues.map((issue) => issue.message).join('; '));
  }

  return result.value;
}

// These tests exercise the sendTextMessage input contract only — they make no
// Twilio calls, so they need no credentials and send no SMS. Sending a real
// message from CI is not viable: Twilio rejects any placeholder number with
// error 21211, and a genuine number would be texted on every single run.
describe('Phone Tools', () => {
  describe('sendTextMessage input schema', () => {
    it('accepts an E.164 number with a message', () => {
      const parsed = parseWithSchema(inputSchema, {
        phoneNumber: '+15551234567',
        message: 'Test message',
      });

      expect(parsed.phoneNumber).toBe('+15551234567');
      expect(parsed.message).toBe('Test message');
    });

    it('rejects input with no phone number', () => {
      expect(() => parseWithSchema(inputSchema, { message: 'Test message' })).toThrow();
    });

    it('rejects input with no message', () => {
      expect(() => parseWithSchema(inputSchema, { phoneNumber: '+15551234567' })).toThrow();
    });

    it('rejects a non-string phone number', () => {
      expect(() => parseWithSchema(inputSchema, { phoneNumber: 15551234567, message: 'Test message' })).toThrow();
    });

    it('rejects a non-string message', () => {
      expect(() => parseWithSchema(inputSchema, { phoneNumber: '+15551234567', message: 42 })).toThrow();
    });
  });

  describe('sendTextMessage definition', () => {
    it('is registered under a stable tool id', () => {
      expect(sendTextMessage.id).toBe('sendTextMessage');
    });

    it('declares the result shape callers depend on', () => {
      const parsed = parseWithSchema(outputSchema, {
        success: true,
        message: 'Text message sent successfully to +15551234567',
        messageSid: 'SM00000000000000000000000000000000',
      });

      expect(parsed.success).toBe(true);
      expect(parsed.messageSid).toBeDefined();
    });

    it('treats messageSid as optional, since a failed send has none', () => {
      const parsed = parseWithSchema(outputSchema, {
        success: false,
        message: 'Could not send',
      });

      expect(parsed.messageSid).toBeUndefined();
    });
  });
});
