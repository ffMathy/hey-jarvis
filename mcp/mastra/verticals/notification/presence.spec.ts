/**
 * Presence tests.
 *
 * Everything here works on a synthetic snapshot of Home Assistant's state, which is exactly what
 * `fetchPresenceSnapshot` returns from its template render. That keeps the interesting part — how
 * a pile of sensor states turns into "he is in the car" — testable without a house.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  CAR_PROXIMITY_METERS,
  derivePresence,
  evaluateCarPresence,
  evaluateHome,
  evaluatePhoneSilence,
  findPerson,
  findUserPhoneSignals,
  type PresenceEntity,
  type PresenceSignal,
  type PresenceSnapshot,
  slugify,
} from './presence.js';

const AARHUS = { latitude: 56.1629, longitude: 10.2039 };
/** Roughly 11km north-east of Aarhus — far beyond any proximity radius. */
const OUT_OF_TOWN = { latitude: 56.26, longitude: 10.24 };

const mathias: PresenceEntity = {
  entityId: 'person.mathias',
  friendlyName: 'Mathias',
  state: 'home',
  ...AARHUS,
};

function snapshotOf(overrides: Partial<PresenceSnapshot> = {}): PresenceSnapshot {
  return { persons: [mathias], trackers: [], signals: [], ...overrides };
}

function signal(entityId: string, state: string): PresenceSignal {
  return { entityId, friendlyName: entityId, state };
}

const environmentKeys = ['HEY_JARVIS_PRIMARY_USER_PHONE_DEVICE', 'HEY_JARVIS_CAR_NAME'] as const;
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));

// These two knobs change how entities are matched, so every test starts from "unset" and puts
// back whatever the surrounding environment had configured.
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

describe('slugify', () => {
  it('turns a display name into the shape entity ids use', () => {
    expect(slugify('Mathias')).toBe('mathias');
    expect(slugify("Mathias' iPhone 15")).toBe('mathias_iphone_15');
    expect(slugify('  Model Y  ')).toBe('model_y');
  });
});

describe('findPerson', () => {
  it('matches on friendly name', () => {
    expect(findPerson(snapshotOf(), 'Mathias')?.entityId).toBe('person.mathias');
  });

  it('matches on entity id when the friendly name is something else', () => {
    const snapshot = snapshotOf({
      persons: [{ ...mathias, friendlyName: 'Husets ejer' }],
    });

    expect(findPerson(snapshot, 'Mathias')?.entityId).toBe('person.mathias');
  });

  it('returns nothing when the person does not exist', () => {
    expect(findPerson(snapshotOf({ persons: [] }), 'Mathias')).toBeUndefined();
  });
});

describe('evaluateHome', () => {
  it('reads home straight off the person entity', () => {
    expect(evaluateHome(mathias, 'Mathias').isHome).toBe(true);
  });

  it('treats any other zone as away', () => {
    expect(evaluateHome({ ...mathias, state: 'Work' }, 'Mathias').isHome).toBe(false);
    expect(evaluateHome({ ...mathias, state: 'not_home' }, 'Mathias').isHome).toBe(false);
  });

  it('is not home when there is no person entity at all', () => {
    const { isHome, reason } = evaluateHome(undefined, 'Mathias');

    expect(isHome).toBe(false);
    expect(reason).toContain('No person entity');
  });
});

describe('findUserPhoneSignals', () => {
  it('picks the entities named after the user', () => {
    const signals = [
      signal('sensor.mathias_iphone_ringer_mode', 'normal'),
      signal('sensor.julie_phone_ringer_mode', 'silent'),
    ];

    expect(findUserPhoneSignals(signals, 'Mathias').map((found) => found.entityId)).toEqual([
      'sensor.mathias_iphone_ringer_mode',
    ]);
  });

  it('picks the configured device and nothing else, even when the name would also match', () => {
    process.env.HEY_JARVIS_PRIMARY_USER_PHONE_DEVICE = 'Pixel 9';
    const signals = [
      signal('sensor.pixel_9_ringer_mode', 'silent'),
      signal('sensor.mathias_ipad_ringer_mode', 'normal'),
    ];

    expect(findUserPhoneSignals(signals, 'Mathias').map((found) => found.entityId)).toEqual([
      'sensor.pixel_9_ringer_mode',
    ]);
  });

  it("returns nothing rather than somebody else's phone when nothing matches", () => {
    const signals = [signal('sensor.julie_phone_ringer_mode', 'silent')];

    expect(findUserPhoneSignals(signals, 'Mathias')).toEqual([]);
  });
});

describe('evaluatePhoneSilence', () => {
  it('is silenced when the ringer is on silent or vibrate', () => {
    expect(evaluatePhoneSilence([signal('sensor.mathias_phone_ringer_mode', 'silent')]).isPhoneSilenced).toBe(true);
    expect(evaluatePhoneSilence([signal('sensor.mathias_phone_ringer_mode', 'vibrate')]).isPhoneSilenced).toBe(true);
  });

  it('is not silenced when the ringer is on normal', () => {
    expect(evaluatePhoneSilence([signal('sensor.mathias_phone_ringer_mode', 'normal')]).isPhoneSilenced).toBe(false);
  });

  it('is silenced by any do-not-disturb mode', () => {
    expect(
      evaluatePhoneSilence([signal('sensor.mathias_phone_do_not_disturb_sensor', 'priority_only')]).isPhoneSilenced,
    ).toBe(true);
    expect(
      evaluatePhoneSilence([signal('sensor.mathias_phone_do_not_disturb_sensor', 'total_silence')]).isPhoneSilenced,
    ).toBe(true);
    expect(evaluatePhoneSilence([signal('binary_sensor.mathias_phone_do_not_disturb', 'on')]).isPhoneSilenced).toBe(
      true,
    );
  });

  it('is not silenced when do-not-disturb is off or unknown', () => {
    for (const state of ['off', 'unknown', 'unavailable']) {
      expect(evaluatePhoneSilence([signal('sensor.mathias_phone_do_not_disturb_sensor', state)]).isPhoneSilenced).toBe(
        false,
      );
    }
  });

  it('is silenced by an active iOS focus mode', () => {
    expect(evaluatePhoneSilence([signal('binary_sensor.mathias_iphone_focus', 'on')]).isPhoneSilenced).toBe(true);
    expect(evaluatePhoneSilence([signal('binary_sensor.mathias_iphone_focus', 'off')]).isPhoneSilenced).toBe(false);
  });

  it("is silenced when Android's interruption filter is letting less than everything through", () => {
    expect(evaluatePhoneSilence([signal('sensor.mathias_phone_interruption_filter', 'priority')]).isPhoneSilenced).toBe(
      true,
    );
    expect(evaluatePhoneSilence([signal('sensor.mathias_phone_interruption_filter', 'all')]).isPhoneSilenced).toBe(
      false,
    );
  });

  it('assumes the phone is audible when nothing reports on it, so an urgent message is still spoken', () => {
    const { isPhoneSilenced, reason } = evaluatePhoneSilence([]);

    expect(isPhoneSilenced).toBe(false);
    expect(reason).toContain('HEY_JARVIS_PRIMARY_USER_PHONE_DEVICE');
  });

  it('is silenced if any one of several signals says so', () => {
    const signals = [
      signal('sensor.mathias_phone_ringer_mode', 'normal'),
      signal('binary_sensor.mathias_iphone_focus', 'on'),
    ];

    expect(evaluatePhoneSilence(signals).isPhoneSilenced).toBe(true);
  });
});

describe('evaluateCarPresence', () => {
  const carTracker: PresenceEntity = {
    entityId: 'device_tracker.tessie_model_y_location',
    friendlyName: 'Model Y Location',
    state: 'not_home',
    ...AARHUS,
  };

  it('believes the phone when activity recognition says it is in a vehicle', () => {
    const phoneSignals = [signal('sensor.mathias_iphone_activity', 'Automotive')];

    expect(evaluateCarPresence(mathias, snapshotOf(), phoneSignals).isInCar).toBe(true);
  });

  it('believes the phone when Android reports in_vehicle', () => {
    const phoneSignals = [signal('sensor.mathias_phone_detected_activity', 'in_vehicle')];

    expect(evaluateCarPresence(mathias, snapshotOf(), phoneSignals).isInCar).toBe(true);
  });

  it('believes a live Android Auto or car Bluetooth connection', () => {
    expect(
      evaluateCarPresence(mathias, snapshotOf(), [signal('binary_sensor.mathias_phone_android_auto', 'on')]).isInCar,
    ).toBe(true);
    expect(
      evaluateCarPresence(mathias, snapshotOf(), [signal('binary_sensor.mathias_phone_car_bluetooth', 'on')]).isInCar,
    ).toBe(true);
  });

  it('ignores a car connection that is off', () => {
    expect(
      evaluateCarPresence(mathias, snapshotOf(), [signal('binary_sensor.mathias_phone_android_auto', 'off')]).isInCar,
    ).toBe(false);
  });

  it('ignores an activity sensor that reports walking', () => {
    expect(
      evaluateCarPresence(mathias, snapshotOf(), [signal('sensor.mathias_iphone_activity', 'Walking')]).isInCar,
    ).toBe(false);
  });

  it('places the user in the car when the car is occupied and he is on top of it', () => {
    const snapshot = snapshotOf({
      trackers: [carTracker],
      signals: [signal('binary_sensor.tessie_model_y_user_present', 'on')],
    });

    const { isInCar, reason } = evaluateCarPresence(mathias, snapshot, []);

    expect(isInCar).toBe(true);
    expect(reason).toContain('device_tracker.tessie_model_y_location');
  });

  it('accepts a moving car as occupied', () => {
    const snapshot = snapshotOf({
      trackers: [carTracker],
      signals: [signal('sensor.tessie_model_y_shift_state', 'D')],
    });

    expect(evaluateCarPresence(mathias, snapshot, []).isInCar).toBe(true);
  });

  it('accepts a non-zero speed as occupied', () => {
    const snapshot = snapshotOf({
      trackers: [carTracker],
      signals: [signal('sensor.tessie_model_y_speed', '65')],
    });

    expect(evaluateCarPresence(mathias, snapshot, []).isInCar).toBe(true);
  });

  it('does not put him in a car that is parked next to him', () => {
    // Without the occupancy check, a car in the driveway would turn every message sent at home
    // into a phone call.
    const snapshot = snapshotOf({
      trackers: [carTracker],
      signals: [signal('binary_sensor.tessie_model_y_user_present', 'off'), signal('sensor.tessie_model_y_speed', '0')],
    });

    const { isInCar, reason } = evaluateCarPresence(mathias, snapshot, []);

    expect(isInCar).toBe(false);
    expect(reason).toContain('nobody on board');
  });

  it('does not put him in a car that somebody else is driving across town', () => {
    const snapshot = snapshotOf({
      trackers: [{ ...carTracker, ...OUT_OF_TOWN }],
      signals: [signal('binary_sensor.tessie_model_y_user_present', 'on')],
    });

    const { isInCar, reason } = evaluateCarPresence(mathias, snapshot, []);

    expect(isInCar).toBe(false);
    expect(reason).toContain(`${CAR_PROXIMITY_METERS}m`);
  });

  it('cannot place him in an occupied car with no GPS fix', () => {
    const snapshot = snapshotOf({
      trackers: [{ ...carTracker, latitude: null, longitude: null }],
      signals: [signal('binary_sensor.tessie_model_y_user_present', 'on')],
    });

    expect(evaluateCarPresence(mathias, snapshot, []).isInCar).toBe(false);
  });

  it('finds a car that is not a Tesla once its name is configured', () => {
    process.env.HEY_JARVIS_CAR_NAME = 'Berlingo';
    const snapshot = snapshotOf({
      trackers: [{ ...carTracker, entityId: 'device_tracker.berlingo' }],
      signals: [signal('binary_sensor.berlingo_user_present', 'on')],
    });

    expect(evaluateCarPresence(mathias, snapshot, []).isInCar).toBe(true);
  });

  it('has nothing to compare against without a person entity', () => {
    expect(evaluateCarPresence(undefined, snapshotOf(), []).isInCar).toBe(false);
  });
});

describe('derivePresence', () => {
  it('answers all three questions from one snapshot', () => {
    const snapshot = snapshotOf({
      signals: [
        signal('sensor.mathias_iphone_ringer_mode', 'silent'),
        signal('sensor.julie_phone_ringer_mode', 'normal'),
      ],
    });

    const presence = derivePresence(snapshot, 'Mathias');

    expect(presence).toMatchObject({
      userName: 'Mathias',
      isHome: true,
      isInCar: false,
      isPhoneSilenced: true,
    });
    expect(presence.reasons.phone).toContain('silent');
  });

  it('reports a driving user as in the car and away', () => {
    const snapshot = snapshotOf({
      persons: [{ ...mathias, state: 'not_home', ...OUT_OF_TOWN }],
      signals: [signal('sensor.mathias_iphone_activity', 'Automotive')],
    });

    const presence = derivePresence(snapshot, 'Mathias');

    expect(presence.isInCar).toBe(true);
    expect(presence.isHome).toBe(false);
  });

  it("does not let somebody else's silent phone silence his announcements", () => {
    const snapshot = snapshotOf({
      signals: [signal('sensor.julie_phone_ringer_mode', 'silent')],
    });

    expect(derivePresence(snapshot, 'Mathias').isPhoneSilenced).toBe(false);
  });

  it('survives an empty house', () => {
    const presence = derivePresence({ persons: [], trackers: [], signals: [] }, 'Mathias');

    expect(presence).toMatchObject({ isHome: false, isInCar: false, isPhoneSilenced: false });
  });
});
