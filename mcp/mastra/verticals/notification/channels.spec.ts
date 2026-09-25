/**
 * Channel-discovery tests.
 *
 * Both selectors work on the shape Home Assistant's `/api/services` returns, so they are tested
 * against a fixture of that shape rather than a live instance.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { ServicesApiEntry } from './channels.js';
import {
  buildPushPayload,
  buildSetAlarmCommand,
  selectAnnounceServices,
  selectMobileAppNotifyService,
} from './channels.js';

const environmentKeys = ['HEY_JARVIS_PRIMARY_USER_NOTIFY_SERVICE', 'HEY_JARVIS_PRIMARY_USER_PHONE_DEVICE'] as const;
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

function servicesOf(domains: Record<string, string[]>): ServicesApiEntry[] {
  return Object.entries(domains).map(([domain, services]) => ({
    domain,
    services: Object.fromEntries(services.map((service) => [service, {}])),
  }));
}

describe('selectAnnounceServices', () => {
  const entries = servicesOf({
    esphome: ['hass_elevenlabs_a1b2c3_announce', 'kitchen_speaker_announce', 'hass_elevenlabs_a1b2c3_set_volume'],
    light: ['turn_on'],
  });

  it('finds every announce service, whatever MAC suffix the firmware picked up', () => {
    expect(selectAnnounceServices(entries).map(({ service }) => service)).toEqual([
      'hass_elevenlabs_a1b2c3_announce',
      'kitchen_speaker_announce',
    ]);
  });

  it('narrows to a single device by name', () => {
    expect(selectAnnounceServices(entries, 'Kitchen').map(({ service }) => service)).toEqual([
      'kitchen_speaker_announce',
    ]);
  });

  it('finds nothing when no device matches the name', () => {
    expect(selectAnnounceServices(entries, 'garage')).toEqual([]);
  });

  it('finds nothing when no voice device is connected at all', () => {
    expect(selectAnnounceServices(servicesOf({ light: ['turn_on'] }))).toEqual([]);
  });
});

describe('selectMobileAppNotifyService', () => {
  it('matches the phone named after the user', () => {
    const entries = servicesOf({
      notify: ['persistent_notification', 'mobile_app_mathias_iphone', 'mobile_app_julie_pixel'],
    });

    expect(selectMobileAppNotifyService(entries, 'Mathias')).toEqual({
      domain: 'notify',
      service: 'mobile_app_mathias_iphone',
    });
  });

  it('uses the configured device slug when the phone is not named after its owner', () => {
    process.env.HEY_JARVIS_PRIMARY_USER_PHONE_DEVICE = 'Pixel 9';
    const entries = servicesOf({ notify: ['mobile_app_pixel_9', 'mobile_app_julie_pixel'] });

    expect(selectMobileAppNotifyService(entries, 'Mathias').service).toBe('mobile_app_pixel_9');
  });

  it('uses the pinned service name above everything else', () => {
    process.env.HEY_JARVIS_PRIMARY_USER_NOTIFY_SERVICE = 'notify.mobile_app_work_phone';

    expect(selectMobileAppNotifyService(servicesOf({}), 'Mathias')).toEqual({
      domain: 'notify',
      service: 'mobile_app_work_phone',
    });
  });

  it('assumes the notify domain when the pinned name has no domain', () => {
    process.env.HEY_JARVIS_PRIMARY_USER_NOTIFY_SERVICE = 'mobile_app_work_phone';

    expect(selectMobileAppNotifyService(servicesOf({}), 'Mathias')).toEqual({
      domain: 'notify',
      service: 'mobile_app_work_phone',
    });
  });

  it('falls back to the only phone in the house', () => {
    const entries = servicesOf({ notify: ['persistent_notification', 'mobile_app_the_phone'] });

    expect(selectMobileAppNotifyService(entries, 'Mathias').service).toBe('mobile_app_the_phone');
  });

  it('refuses to guess between several phones', () => {
    const entries = servicesOf({ notify: ['mobile_app_one', 'mobile_app_two'] });

    expect(() => selectMobileAppNotifyService(entries, 'Mathias')).toThrow(/HEY_JARVIS_PRIMARY_USER_NOTIFY_SERVICE/);
  });

  it('says so when no phone has the companion app', () => {
    expect(() => selectMobileAppNotifyService(servicesOf({ notify: ['persistent_notification'] }), 'Mathias')).toThrow(
      /companion app/,
    );
  });
});

describe('buildPushPayload', () => {
  it('sends a plain message on its own', () => {
    expect(buildPushPayload({ message: 'The laundry is done.', isUrgent: false })).toEqual({
      message: 'The laundry is done.',
    });
  });

  it('includes a title when there is one', () => {
    expect(buildPushPayload({ message: 'The laundry is done.', title: 'Laundry', isUrgent: false })).toEqual({
      message: 'The laundry is done.',
      title: 'Laundry',
    });
  });

  it('asks to break through a focus mode when the message is urgent', () => {
    // This is the case that routes here: something urgent for a user whose phone is silenced.
    expect(buildPushPayload({ message: 'Water on the floor.', isUrgent: true })).toEqual({
      message: 'Water on the floor.',
      data: {
        ttl: 0,
        priority: 'high',
        push: { 'interruption-level': 'time-sensitive' },
      },
    });
  });
});

describe('buildSetAlarmCommand', () => {
  it("launches Android's SET_ALARM through the companion app, with the time as integers", () => {
    expect(buildSetAlarmCommand({ hour: 6, minute: 30 })).toEqual({
      message: 'command_activity',
      data: {
        intent_action: 'android.intent.action.SET_ALARM',
        intent_extras:
          'android.intent.extra.alarm.HOUR:6:int,android.intent.extra.alarm.MINUTES:30:int,android.intent.extra.alarm.SKIP_UI:true:boolean',
      },
    });
  });

  it('URL-encodes the label, so its commas and colons cannot split the extras', () => {
    const { data } = buildSetAlarmCommand({ hour: 14, minute: 0, label: 'Laundry: towels, sheets' });
    const extras = data.intent_extras.split(',');

    expect(extras).toHaveLength(4);
    expect(extras[3]).toBe('android.intent.extra.alarm.MESSAGE:Laundry%3A%20towels%2C%20sheets:urlencoded');
  });

  it('leaves the label out when it is blank', () => {
    const { data } = buildSetAlarmCommand({ hour: 7, minute: 5, label: '   ' });

    expect(data.intent_extras).not.toContain('MESSAGE');
  });
});
