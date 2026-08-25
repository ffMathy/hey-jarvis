/**
 * Notification tool tests that only a real Home Assistant can answer — whether the presence
 * template renders and whether the voice devices expose an announce service.
 *
 * They reach the instance through the Cloudflared tunnel in HEY_JARVIS_HOME_ASSISTANT_URL, so
 * they run from anywhere and are never skipped. Both still stop short of delivering anything:
 * the device name is one that cannot match, and presence is only read.
 *
 * The refusals that happen before any service is called need none of this, so they stay in
 * `tools.spec.ts` and run on every push.
 */

import { describe, expect, it } from 'bun:test';
import { executeTool } from '../../utils/tool-factory.js';
import { getPrimaryUserPresence, notifyDevice } from './tools';

describe('Notification Tools', () => {
  describe('notifyDevice', () => {
    it('announces nothing when no voice device matches the requested name', async () => {
      const result = await executeTool(notifyDevice, {
        message: 'This should never be spoken.',
        deviceName: 'a-voice-device-that-does-not-exist',
      });

      expect(result.success).toBe(false);
      expect(result.servicesCalled).toEqual([]);

      console.log('✅ Announcement correctly withheld from an unknown device');
    }, 30000);
  });

  describe('getPrimaryUserPresence', () => {
    it('answers all three presence questions from Home Assistant', async () => {
      const presence = await executeTool(getPrimaryUserPresence, {});

      expect(typeof presence.userName).toBe('string');
      expect(typeof presence.isInCar).toBe('boolean');
      expect(typeof presence.isHome).toBe('boolean');
      expect(typeof presence.isPhoneSilenced).toBe('boolean');
      expect(presence.reasons.home.length).toBeGreaterThan(0);
      expect(presence.reasons.car.length).toBeGreaterThan(0);
      expect(presence.reasons.phone.length).toBeGreaterThan(0);

      console.log('✅ Presence read from Home Assistant');
      console.log('   - In car:', presence.isInCar);
      console.log('   - Home:', presence.isHome);
      console.log('   - Phone silenced:', presence.isPhoneSilenced);
    }, 30000);
  });
});
