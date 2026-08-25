/**
 * Presence tests.
 *
 * The shortcuts fetch from the IoT vertical and then read the result; these cover the reading. The
 * fixtures are the shape `getAllDevices` and `inferUserLocation` return, so how a pile of device
 * states turns into "he is in the car" is testable without a house, a car or a phone.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { DeviceState, UserLocation } from '../internet-of-things/tools.js';
import {
  CAR_PROXIMITY_METERS,
  findUserPhoneDevice,
  isCarDevice,
  isUserPhoneDevice,
  readCarAnswer,
  readHomeAnswer,
  slugify,
} from './shortcuts.js';

const AARHUS = { latitude: 56.1629, longitude: 10.2039 };
/** Roughly 11km north-east of Aarhus — far beyond any proximity radius. */
const OUT_OF_TOWN = { latitude: 56.26, longitude: 10.24 };

const environmentKeys = ['HEY_JARVIS_PRIMARY_USER_PHONE_DEVICE', 'HEY_JARVIS_CAR_NAME'] as const;
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));

// These two knobs change how devices are matched, so every test starts from "unset" and puts back
// whatever the surrounding environment had configured.
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

function entity(id: string, state: string, attributes: Record<string, unknown> = {}) {
  return {
    id,
    domain: id.split('.')[0],
    area: null,
    labels: [],
    state,
    attributes,
    last_changed: '2026-08-25T00:00:00Z',
  };
}

function device(name: string, entities: ReturnType<typeof entity>[]): DeviceState {
  return { id: slugify(name), name, labels: [], area: null, last_changed: '2026-08-25T00:00:00Z', entities };
}

function locationOf(overrides: Partial<UserLocation> = {}): UserLocation {
  return {
    userId: 'person.mathias',
    userName: 'Mathias',
    state: 'home',
    latitude: AARHUS.latitude,
    longitude: AARHUS.longitude,
    gpsAccuracy: 10,
    lastChanged: '2026-08-25T00:00:00Z',
    source: 'device_tracker.mathias_iphone',
    distancesFromZones: [{ zoneName: 'Home', zoneId: 'zone.home', distanceMeters: 5, isInZone: true }],
    ...overrides,
  };
}

/** A phone with the companion-app entities Home Assistant creates for it. */
function phoneDevice(name = "Mathias' iPhone", entities = [entity('sensor.mathias_iphone_ringer_mode', 'normal')]) {
  return device(name, entities);
}

/** A parked Tesla, as Tessie reports it. */
function carDevice(entities = [entity('binary_sensor.tessie_model_y_user_present', 'off')]) {
  return device('Model Y', [entity('device_tracker.tessie_model_y_location', 'not_home', AARHUS), ...entities]);
}

describe('slugify', () => {
  it('turns a display name into the shape entity ids use', () => {
    expect(slugify('Mathias')).toBe('mathias');
    expect(slugify("Mathias' iPhone 15")).toBe('mathias_iphone_15');
    expect(slugify('  Model Y  ')).toBe('model_y');
  });
});

describe('isCarDevice', () => {
  it('recognises a Tesla by its Tessie entities', () => {
    expect(isCarDevice(carDevice())).toBe(true);
  });

  it('recognises a car by the entities only a car has, whatever it is called', () => {
    expect(isCarDevice(device('Bilen', [entity('sensor.bilen_shift_state', 'P')]))).toBe(true);
  });

  it('recognises a car that has been named in configuration', () => {
    process.env.HEY_JARVIS_CAR_NAME = 'Berlingo';

    expect(isCarDevice(device('Berlingo', [entity('device_tracker.berlingo', 'not_home')]))).toBe(true);
  });

  it('leaves the rest of the house alone', () => {
    expect(isCarDevice(device('Kitchen Light', [entity('light.kitchen', 'on')]))).toBe(false);
    expect(isCarDevice(phoneDevice())).toBe(false);
  });
});

describe('isUserPhoneDevice', () => {
  it('recognises a phone named after its owner', () => {
    expect(isUserPhoneDevice(phoneDevice(), 'Mathias')).toBe(true);
  });

  it('recognises the phone named in configuration, whoever it belongs to', () => {
    process.env.HEY_JARVIS_PRIMARY_USER_PHONE_DEVICE = 'Pixel 9';
    const pixel = device('Pixel 9', [entity('sensor.pixel_9_ringer_mode', 'silent')]);

    expect(isUserPhoneDevice(pixel, 'Mathias')).toBe(true);
  });

  it("does not mistake somebody else's phone for his", () => {
    const julie = device("Julie's Phone", [entity('sensor.julie_phone_ringer_mode', 'silent')]);

    expect(isUserPhoneDevice(julie, 'Mathias')).toBe(false);
  });

  it('does not mistake a laptop named after him for a phone', () => {
    // Without the companion-app check, any device carrying his name would answer for his ringer.
    const laptop = device("Mathias' MacBook", [entity('sensor.mathias_macbook_uptime', '4')]);

    expect(isUserPhoneDevice(laptop, 'Mathias')).toBe(false);
  });

  it('finds his phone among the household devices', () => {
    const devices = [device('Kitchen Light', [entity('light.kitchen', 'on')]), phoneDevice()];

    expect(findUserPhoneDevice(devices, 'Mathias')?.name).toBe("Mathias' iPhone");
  });
});

describe('readHomeAnswer', () => {
  it('reads home straight off the person entity', () => {
    expect(readHomeAnswer(locationOf()).answer).toBe(true);
  });

  it('treats any other zone as away', () => {
    const away = locationOf({
      state: 'Work',
      distancesFromZones: [{ zoneName: 'Home', zoneId: 'zone.home', distanceMeters: 8000, isInZone: false }],
    });

    expect(readHomeAnswer(away).answer).toBe(false);
  });

  it('counts him as home when he is inside the home zone under another name', () => {
    // A person standing in a named sub-zone of the property reports that zone, not "home".
    const inGarden = locationOf({
      state: 'Garden',
      distancesFromZones: [{ zoneName: 'Home', zoneId: 'zone.home', distanceMeters: 20, isInZone: true }],
    });

    expect(readHomeAnswer(inGarden).answer).toBe(true);
  });

  it('is not home when Home Assistant tracks no person at all', () => {
    const { answer, reason } = readHomeAnswer(undefined);

    expect(answer).toBe(false);
    expect(reason).toContain('no person entity');
  });
});

describe('readCarAnswer', () => {
  it('believes the phone when activity recognition says it is in a vehicle', () => {
    const phone = phoneDevice("Mathias' iPhone", [entity('sensor.mathias_iphone_activity', 'Automotive')]);

    expect(readCarAnswer({ location: locationOf(), devices: [phone] }).answer).toBe(true);
  });

  it('believes the phone when Android reports in_vehicle', () => {
    const phone = phoneDevice("Mathias' Phone", [entity('sensor.mathias_phone_detected_activity', 'in_vehicle')]);

    expect(readCarAnswer({ location: locationOf(), devices: [phone] }).answer).toBe(true);
  });

  it('believes a live Android Auto or car Bluetooth connection', () => {
    for (const entityId of ['binary_sensor.mathias_phone_android_auto', 'binary_sensor.mathias_phone_car_bluetooth']) {
      const phone = phoneDevice("Mathias' Phone", [entity(entityId, 'on')]);

      expect(readCarAnswer({ location: locationOf(), devices: [phone] }).answer).toBe(true);
    }
  });

  it('ignores a car connection that is off and an activity that is not driving', () => {
    const phone = phoneDevice("Mathias' Phone", [
      entity('binary_sensor.mathias_phone_android_auto', 'off'),
      entity('sensor.mathias_phone_activity', 'Walking'),
    ]);

    expect(readCarAnswer({ location: locationOf(), devices: [phone] }).answer).toBe(false);
  });

  it('places him in the car when it is occupied and he is on top of it', () => {
    const car = carDevice([entity('binary_sensor.tessie_model_y_user_present', 'on')]);
    const { answer, reason } = readCarAnswer({ location: locationOf(), devices: [car] });

    expect(answer).toBe(true);
    expect(reason).toContain('Model Y');
  });

  it('accepts a car in gear or moving as occupied', () => {
    for (const occupancy of [
      entity('sensor.tessie_model_y_shift_state', 'D'),
      entity('sensor.tessie_model_y_speed', '65'),
    ]) {
      expect(readCarAnswer({ location: locationOf(), devices: [carDevice([occupancy])] }).answer).toBe(true);
    }
  });

  it('does not put him in a car that is parked next to him', () => {
    // Without the occupancy check, a car in the driveway would turn every message sent at home
    // into a phone call.
    const parked = carDevice([
      entity('binary_sensor.tessie_model_y_user_present', 'off'),
      entity('sensor.tessie_model_y_speed', '0'),
    ]);
    const { answer, reason } = readCarAnswer({ location: locationOf(), devices: [parked] });

    expect(answer).toBe(false);
    expect(reason).toContain('nobody on board');
  });

  it('does not put him in a car somebody else is driving across town', () => {
    const elsewhere = device('Model Y', [
      entity('device_tracker.tessie_model_y_location', 'not_home', OUT_OF_TOWN),
      entity('binary_sensor.tessie_model_y_user_present', 'on'),
    ]);
    const { answer, reason } = readCarAnswer({ location: locationOf(), devices: [elsewhere] });

    expect(answer).toBe(false);
    expect(reason).toContain(`${CAR_PROXIMITY_METERS}m`);
  });

  it('cannot place him in an occupied car that reports no position', () => {
    const positionless = device('Model Y', [entity('binary_sensor.tessie_model_y_user_present', 'on')]);

    expect(readCarAnswer({ location: locationOf(), devices: [positionless] }).answer).toBe(false);
  });

  it('cannot place him in an occupied car when he has no GPS fix', () => {
    const car = carDevice([entity('binary_sensor.tessie_model_y_user_present', 'on')]);
    const noFix = locationOf({ latitude: null, longitude: null });

    expect(readCarAnswer({ location: noFix, devices: [car] }).answer).toBe(false);
  });

  it('reads a car position Home Assistant sent as a string', () => {
    const stringy = device('Model Y', [
      entity('device_tracker.tessie_model_y_location', 'not_home', {
        latitude: String(AARHUS.latitude),
        longitude: String(AARHUS.longitude),
      }),
      entity('binary_sensor.tessie_model_y_user_present', 'on'),
    ]);

    expect(readCarAnswer({ location: locationOf(), devices: [stringy] }).answer).toBe(true);
  });

  it('survives a house with no car and no phone', () => {
    expect(readCarAnswer({ location: locationOf(), devices: [] }).answer).toBe(false);
  });
});
