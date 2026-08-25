/**
 * Notification tool tests that need nothing outside the process.
 *
 * These deliberately stop short of delivering anything: every path that would announce in the
 * house, ring a phone or push to a device is covered by the pure routing and channel tests
 * instead. What is left here are the refusals that happen before any service is called.
 *
 * The cases that only a real Home Assistant can answer — whether the presence template renders
 * and whether the voice devices expose an announce service — live in `tools.integration.spec.ts`.
 */

import { describe, expect, it } from 'bun:test';
import { executeTool } from '../../utils/tool-factory.js';
import { sendNotification } from './tools';

describe('Notification Tools', () => {
  describe('sendNotification', () => {
    it('refuses a contact that has neither a phone number nor an email address', async () => {
      // The refusal comes out of the routing decision, so nothing is called and nothing is sent.
      await expect(
        executeTool(sendNotification, {
          target: { type: 'contact', name: 'Nobody' },
          message: 'This should never go anywhere.',
        }),
      ).rejects.toThrow(/neither a phone number nor an email address/);
    });
  });
});
