/**
 * Presence-source tests.
 *
 * Every notification to the user asks where he is, and finding his car and phone used to render
 * every device in the house each time. These pin what replaced that: the house is searched once,
 * after which only the car and the phone are rendered -- always with fresh states -- and anything
 * going wrong with that short render falls back to the full search.
 *
 * Home Assistant is faked at `fetch`, scoped to each test, and given a made-up address.
 */

import { afterEach, beforeEach, describe, expect, it, setSystemTime, spyOn } from 'bun:test';
import { z } from 'zod';
import { type DeviceState, resetHomeAssistantCachesForTest } from '../internet-of-things/tools.js';
import { fetchPresenceSources, resetPresenceCachesForTest } from './shortcuts.js';

const templateRequestSchema = z.object({ template: z.string() });

const environmentKeys = [
  'HEY_JARVIS_HOME_ASSISTANT_URL',
  'HEY_JARVIS_HOME_ASSISTANT_TOKEN',
  'HEY_JARVIS_PRIMARY_USER_PHONE_DEVICE',
  'HEY_JARVIS_CAR_NAME',
] as const;
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));

function entity(id: string, state: string, attributes: Record<string, unknown> = {}) {
  return {
    id,
    domain: id.split('.')[0] ?? '',
    area: null,
    labels: [],
    state,
    attributes,
    last_changed: '2026-09-26T08:00:00+00:00',
  };
}

function device(id: string, name: string, entities: ReturnType<typeof entity>[]): DeviceState {
  return { id, name, labels: [], area: null, last_changed: '2026-09-26T08:00:00+00:00', entities };
}

function phoneWithRinger(ringerMode: string): DeviceState {
  return device('phone-device', "Mathias' iPhone", [entity('sensor.mathias_iphone_ringer_mode', ringerMode)]);
}

const car = device('car-device', 'Model Y', [
  entity('binary_sensor.tessie_model_y_user_present', 'off'),
  entity('device_tracker.tessie_model_y_location', 'home', { latitude: 56.1629, longitude: 10.2039 }),
]);
const lamp = device('lamp-device', 'Sofa lamp', [entity('light.sofa_lamp', 'on')]);

const person = {
  entity_id: 'person.mathias',
  state: 'home',
  friendly_name: 'Mathias',
  latitude: 56.1629,
  longitude: 10.2039,
  gps_accuracy: 10,
  source: 'device_tracker.mathias_iphone',
  last_changed: '2026-09-26T08:00:00+00:00',
};

/** Which of the templates presence renders a request is. */
function kindOf(template: string): 'people' | 'device ids' | 'every device' | 'presence devices' {
  if (template.includes('states.person')) {
    return 'people';
  }
  if (template.includes("map('device_id')")) {
    return 'device ids';
  }
  // Both device renders use the same template; the search renders every device, the lamp included.
  return template.includes('"lamp-device"') ? 'every device' : 'presence devices';
}

/**
 * A house with a phone, a car and a lamp.
 *
 * `house.phone` is what the phone reports right now, and `house.presenceRender` answers the short
 * render of the car and the phone, so a test can change either between requests.
 */
function fakeHouse() {
  const rendered: Array<{ kind: ReturnType<typeof kindOf>; template: string }> = [];
  const house = {
    phone: phoneWithRinger('normal'),
    presenceRender: (): unknown => [house.phone, car],
    rendered,
  };

  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const { template } = templateRequestSchema.parse(JSON.parse(String(init?.body ?? '{}')));
        const kind = kindOf(template);
        house.rendered.push({ kind, template });

        const answers = {
          people: () => ({ persons: [person], zones: [] }),
          'device ids': () => [house.phone.id, car.id, lamp.id],
          'every device': () => [house.phone, car, lamp],
          'presence devices': house.presenceRender,
        };
        return new Response(JSON.stringify(answers[kind]()));
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );

  const kinds = () => house.rendered.map(({ kind }) => kind).filter((kind) => kind !== 'people');

  return { house, fetchSpy, kinds };
}

beforeEach(() => {
  for (const key of environmentKeys) {
    delete process.env[key];
  }
  process.env.HEY_JARVIS_HOME_ASSISTANT_URL = 'http://home-assistant.test';
  process.env.HEY_JARVIS_HOME_ASSISTANT_TOKEN = 'test-token';
  resetHomeAssistantCachesForTest();
  resetPresenceCachesForTest();
});

afterEach(() => {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetHomeAssistantCachesForTest();
  resetPresenceCachesForTest();
  setSystemTime();
});

describe('fetchPresenceSources', () => {
  it('searches the house once, and afterwards renders only the car and the phone', async () => {
    const { house, fetchSpy, kinds } = fakeHouse();

    const first = await fetchPresenceSources('Mathias');
    const second = await fetchPresenceSources('Mathias');

    expect(kinds()).toEqual(['device ids', 'every device', 'presence devices']);
    expect(first.devices.map(({ id }) => id)).toEqual(['phone-device', 'car-device']);
    expect(second.devices.map(({ id }) => id)).toEqual(['phone-device', 'car-device']);
    expect(second.location?.userId).toBe('person.mathias');

    const presenceRender = house.rendered.find(({ kind }) => kind === 'presence devices');
    expect(presenceRender?.template).toContain('["phone-device","car-device"]');
    expect(presenceRender?.template).not.toContain('lamp-device');
    fetchSpy.mockRestore();
  });

  it('always reads the states fresh', async () => {
    const { house, fetchSpy } = fakeHouse();
    await fetchPresenceSources('Mathias');

    house.phone = phoneWithRinger('silent');
    const { devices } = await fetchPresenceSources('Mathias');

    expect(devices[0]?.entities[0]?.state).toBe('silent');
    fetchSpy.mockRestore();
  });

  it('drops a remembered device that is no longer the car or the phone', async () => {
    const { house, fetchSpy } = fakeHouse();
    await fetchPresenceSources('Mathias');

    house.presenceRender = () => [device('phone-device', 'Old tablet', [entity('sensor.old_tablet_uptime', '4')]), car];
    const { devices } = await fetchPresenceSources('Mathias');

    expect(devices.map(({ id }) => id)).toEqual(['car-device']);
    fetchSpy.mockRestore();
  });

  it('searches every device again when a remembered one has gone', async () => {
    const { house, fetchSpy, kinds } = fakeHouse();
    await fetchPresenceSources('Mathias');

    // Reinstalling the companion app registers the phone as a new device.
    house.phone = device('new-phone-device', "Mathias' iPhone", [
      entity('sensor.mathias_iphone_ringer_mode', 'silent'),
    ]);
    house.presenceRender = () => [car];
    resetHomeAssistantCachesForTest();
    const { devices } = await fetchPresenceSources('Mathias');

    expect(devices.map(({ id }) => id)).toEqual(['new-phone-device', 'car-device']);
    expect(kinds()).toEqual(['device ids', 'every device', 'presence devices', 'device ids', 'every device']);
    fetchSpy.mockRestore();
  });

  it('searches every device again when the short render cannot be read', async () => {
    const { house, fetchSpy, kinds } = fakeHouse();
    await fetchPresenceSources('Mathias');

    house.presenceRender = () => ({ error: 'not a list of devices' });
    const { devices } = await fetchPresenceSources('Mathias');

    expect(devices.map(({ id }) => id)).toEqual(['phone-device', 'car-device']);
    expect(kinds()).toEqual(['device ids', 'every device', 'presence devices', 'every device']);
    fetchSpy.mockRestore();
  });

  it('answers from remembered devices once they are old, and searches again behind the request', async () => {
    setSystemTime(new Date('2026-09-26T08:00:00Z'));
    const { fetchSpy, kinds } = fakeHouse();
    await fetchPresenceSources('Mathias');

    setSystemTime(new Date('2026-09-26T09:00:00Z'));
    const { devices } = await fetchPresenceSources('Mathias');
    await Bun.sleep(10);

    expect(devices.map(({ id }) => id)).toEqual(['phone-device', 'car-device']);
    // The short render and the search behind it run side by side, so only what ran is certain.
    expect(kinds().slice(2).sort()).toEqual(['device ids', 'every device', 'presence devices']);
    fetchSpy.mockRestore();
  });
});
