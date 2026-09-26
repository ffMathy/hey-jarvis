/**
 * "Where is the car driving to?", against a faked Home Assistant.
 *
 * The car's navigation is a handful of sensors and trackers, so the shortcut asks Home Assistant
 * for those two domains only, instead of every device in the house with every attribute. These
 * pin that it still finds the car, and still returns exactly its navigation entities.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { z } from 'zod';
import { executeTool } from '../../utils/tool-factory.js';
import { type DeviceState, resetHomeAssistantCachesForTest } from '../internet-of-things/tools.js';
import { getCarNavigationDestination, mergeDevicesAcrossDomains } from './shortcuts.js';

const templateRequestSchema = z.object({ template: z.string() });

const HOME_ASSISTANT_ENV = ['HEY_JARVIS_HOME_ASSISTANT_URL', 'HEY_JARVIS_HOME_ASSISTANT_TOKEN'] as const;

type Entity = DeviceState['entities'][number];

function entity(id: string, lastChanged = '2026-09-26T08:00:00+00:00'): Entity {
  return {
    id,
    domain: id.split('.')[0],
    area: null,
    labels: [],
    state: 'on',
    attributes: {},
    last_changed: lastChanged,
  };
}

function device(id: string, entities: Entity[], lastChanged = '2026-09-26T08:00:00+00:00'): DeviceState {
  return { id, name: id, labels: [], area: null, last_changed: lastChanged, entities };
}

/** The car and a phone, as Home Assistant renders them when asked for one domain. */
const devicesByDomain: Record<string, DeviceState[]> = {
  sensor: [
    device('car', [entity('sensor.model_y_destination'), entity('sensor.model_y_battery_level')]),
    device('phone', [entity('sensor.pixel_battery_level')]),
  ],
  device_tracker: [
    device(
      'car',
      [entity('device_tracker.model_y_location', '2026-09-26T09:00:00+00:00')],
      '2026-09-26T09:00:00+00:00',
    ),
    device('phone', [entity('device_tracker.pixel')]),
  ],
};

/**
 * Answers each template render the way Home Assistant would for the domain it filters on.
 *
 * Bun's `fetch` carries a `preconnect` function as well as its call signature, so a bare
 * function is not one; the real `preconnect` is carried over to make it whole.
 */
function fakeHomeAssistant() {
  const templates: string[] = [];
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const { template } = templateRequestSchema.parse(JSON.parse(String(init?.body ?? '{}')));
        templates.push(template);

        const domain = Object.keys(devicesByDomain).find(
          (candidate) => template.includes(`states.${candidate}|`) || template.includes(`st.domain == '${candidate}'`),
        );
        const devices = domain ? devicesByDomain[domain] : [];
        const body = template.includes("map('device_id')") ? devices.map((candidate) => candidate.id) : devices;
        return new Response(JSON.stringify(body));
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );

  return { templates, fetchSpy };
}

describe('getCarNavigationDestination', () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const name of HOME_ASSISTANT_ENV) {
      saved.set(name, process.env[name]);
    }
    process.env.HEY_JARVIS_HOME_ASSISTANT_URL = 'http://home-assistant.test';
    process.env.HEY_JARVIS_HOME_ASSISTANT_TOKEN = 'test-token';
    resetHomeAssistantCachesForTest();
  });

  afterEach(() => {
    for (const name of HOME_ASSISTANT_ENV) {
      const value = saved.get(name);
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    resetHomeAssistantCachesForTest();
  });

  it("asks only for sensors and trackers, and returns just the car's navigation entities", async () => {
    const { templates, fetchSpy } = fakeHomeAssistant();

    const { devices } = await executeTool(getCarNavigationDestination, {});

    const idLookups = templates.filter((template) => template.includes("map('device_id')"));
    expect(idLookups).toHaveLength(2);
    expect(idLookups.some((template) => template.includes('{{ states|'))).toBe(false);
    expect(devices.map((found) => found.id)).toEqual(['car']);
    expect(devices[0].entities.map((found) => found.id)).toEqual([
      'sensor.model_y_destination',
      'device_tracker.model_y_location',
    ]);
    fetchSpy.mockRestore();
  });
});

describe('mergeDevicesAcrossDomains', () => {
  it('joins the views of one device, keeping its latest change', () => {
    const merged = mergeDevicesAcrossDomains([devicesByDomain.sensor, devicesByDomain.device_tracker]);

    expect(merged.map((found) => found.id)).toEqual(['car', 'phone']);
    expect(merged[0].entities).toHaveLength(3);
    expect(merged[0].last_changed).toBe('2026-09-26T09:00:00+00:00');
    expect(merged[1].last_changed).toBe('2026-09-26T08:00:00+00:00');
  });
});
