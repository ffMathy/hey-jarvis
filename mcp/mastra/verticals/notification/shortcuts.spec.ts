/**
 * Silent-mode tests.
 *
 * The shortcut fetches the phone from the IoT vertical; this covers the reading of it, against the
 * device shape `getAllDevices` returns.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { DeviceState } from '../internet-of-things/tools.js';
import { readPhoneSilenceAnswer } from './shortcuts.js';

const environmentKeys = ['HEY_JARVIS_PRIMARY_USER_PHONE_DEVICE'] as const;
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));

beforeEach(() => {
  for (const key of environmentKeys) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function entity(id: string, state: string) {
  return {
    id,
    domain: id.split('.')[0],
    area: null,
    labels: [],
    state,
    attributes: {},
    last_changed: '2026-08-25T00:00:00Z',
  };
}

/** The primary user's phone, carrying whichever companion-app sensors a test cares about. */
function phoneWith(...entities: ReturnType<typeof entity>[]): DeviceState[] {
  return [
    {
      id: 'mathias_iphone',
      name: "Mathias' iPhone",
      labels: [],
      area: null,
      last_changed: '2026-08-25T00:00:00Z',
      entities,
    },
  ];
}

describe('readPhoneSilenceAnswer', () => {
  it('is silenced when the ringer is on silent or vibrate', () => {
    for (const state of ['silent', 'vibrate']) {
      expect(readPhoneSilenceAnswer(phoneWith(entity('sensor.mathias_iphone_ringer_mode', state))).answer).toBe(true);
    }
  });

  it('is not silenced when the ringer is on normal', () => {
    expect(readPhoneSilenceAnswer(phoneWith(entity('sensor.mathias_iphone_ringer_mode', 'normal'))).answer).toBe(false);
  });

  it('is silenced by any do-not-disturb mode', () => {
    for (const state of ['priority_only', 'total_silence', 'alarms_only']) {
      expect(
        readPhoneSilenceAnswer(phoneWith(entity('sensor.mathias_iphone_do_not_disturb_sensor', state))).answer,
      ).toBe(true);
    }

    expect(readPhoneSilenceAnswer(phoneWith(entity('binary_sensor.mathias_iphone_do_not_disturb', 'on'))).answer).toBe(
      true,
    );
  });

  it('is not silenced when do-not-disturb is off or unreported', () => {
    for (const state of ['off', 'unknown', 'unavailable']) {
      expect(
        readPhoneSilenceAnswer(phoneWith(entity('sensor.mathias_iphone_do_not_disturb_sensor', state))).answer,
      ).toBe(false);
    }
  });

  it('is silenced by an active iOS focus mode', () => {
    expect(readPhoneSilenceAnswer(phoneWith(entity('binary_sensor.mathias_iphone_focus', 'on'))).answer).toBe(true);
    expect(readPhoneSilenceAnswer(phoneWith(entity('binary_sensor.mathias_iphone_focus', 'off'))).answer).toBe(false);
  });

  it("is silenced when Android's interruption filter lets less than everything through", () => {
    expect(
      readPhoneSilenceAnswer(phoneWith(entity('sensor.mathias_iphone_interruption_filter', 'priority'))).answer,
    ).toBe(true);
    expect(readPhoneSilenceAnswer(phoneWith(entity('sensor.mathias_iphone_interruption_filter', 'all'))).answer).toBe(
      false,
    );
  });

  it('is silenced if any one of several sensors says so', () => {
    const answer = readPhoneSilenceAnswer(
      phoneWith(
        entity('sensor.mathias_iphone_ringer_mode', 'normal'),
        entity('binary_sensor.mathias_iphone_focus', 'on'),
      ),
    );

    expect(answer.answer).toBe(true);
  });

  it('assumes the phone is audible when no phone is found, so an urgent message is still spoken', () => {
    const { answer, reason } = readPhoneSilenceAnswer([]);

    expect(answer).toBe(false);
    expect(reason).toContain('HEY_JARVIS_PRIMARY_USER_PHONE_DEVICE');
  });

  it("never lets somebody else's silent phone silence his announcements", () => {
    const julie: DeviceState[] = [
      {
        id: 'julie_phone',
        name: "Julie's Phone",
        labels: [],
        area: null,
        last_changed: '2026-08-25T00:00:00Z',
        entities: [entity('sensor.julie_phone_ringer_mode', 'silent')],
      },
    ];

    expect(readPhoneSilenceAnswer(julie).answer).toBe(false);
  });
});
