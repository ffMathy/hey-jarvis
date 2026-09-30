/**
 * What the Home Assistant tools report as touched, which is what sir's headset lights up.
 *
 * The service call is the one that matters most and knows least: "turn off the living room lights"
 * names an area, and which lights that reached only Home Assistant can say. So the call resolves
 * its targets alongside itself, and these pin that the resolution follows the service's own rules
 * -- the ids given, and the domain's entities in the areas and devices given -- and that nothing it
 * does can fail the call or hold it up.
 *
 * Home Assistant is faked at `fetch`, scoped to each test, and given a made-up address.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { z } from 'zod';
import { readAffectedEntities } from '../../utils/affected-entities.js';
import { executeTool } from '../../utils/tool-factory.js';
import { callIoTService, findEntities, getEntityLogbook, MOST_ENTITIES_A_LOOKUP_AFFECTS } from './tools.js';

const templateRequestSchema = z.object({ template: z.string() });

const HOME_ASSISTANT_ENV = ['HEY_JARVIS_HOME_ASSISTANT_URL', 'HEY_JARVIS_HOME_ASSISTANT_TOKEN'] as const;

/** What each entity in the fake house is called. */
const ENTITY_NAMES: Record<string, string> = {
  'light.sofa_lamp': 'Sofa lamp',
  'light.ceiling': 'Ceiling',
  'media_player.living_room': 'Living room speaker',
  'light.kitchen_spots': 'Kitchen spots',
};

/** Which entities each area of the fake house has. */
const AREA_ENTITIES: Record<string, string[]> = {
  living_room: ['light.sofa_lamp', 'light.ceiling', 'media_player.living_room'],
};

/** Which entities each device of the fake house has. */
const DEVICE_ENTITIES: Record<string, string[]> = { 'kitchen-spots-device': ['light.kitchen_spots'] };

/**
 * Plays a target-resolution template against the fake house, as Home Assistant would render it.
 *
 * Only the template's inputs are read back out of it -- the ids, areas and devices it was written
 * with, and whether it narrows to a domain -- so what is tested is that the tool asks the right
 * question, not a re-implementation of Jinja.
 */
function renderTargets(template: string): { id: string; name: string }[] {
  const lists = [...template.matchAll(/(?:ids=|for [ad] in )(\[[^\]]*\])/g)].map((match) =>
    z.array(z.string()).parse(JSON.parse(match[1])),
  );
  const [entityIds, areaIds, deviceIds] = lists;
  const domain = template.match(/e\.startswith\('([a-z_]+)\.'\)/)?.[1];
  const inDomain = (id: string) => !domain || id.startsWith(`${domain}.`);

  const ids = [
    ...entityIds,
    ...areaIds.flatMap((area) => (AREA_ENTITIES[area] ?? []).filter(inDomain)),
    ...deviceIds.flatMap((device) => (DEVICE_ENTITIES[device] ?? []).filter(inDomain)),
  ];
  return [...new Set(ids)].filter((id) => id in ENTITY_NAMES).map((id) => ({ id, name: ENTITY_NAMES[id] }));
}

/**
 * A stand-in for `fetch` that answers service calls with `answerService` and template renders with
 * `answerTemplate`.
 *
 * Bun's `fetch` carries a `preconnect` function as well as its call signature, so a bare function is
 * not one; the real `preconnect` is carried over to make it whole.
 */
function fakeHomeAssistant(
  answerTemplate: (template: string) => Promise<Response> | Response = (template) =>
    new Response(JSON.stringify(renderTargets(template))),
  answerService: () => Response = () => new Response('[]'),
) {
  const serviceCalls: string[] = [];
  const templates: string[] = [];
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = String(input);
        if (url.includes('/api/services/')) {
          serviceCalls.push(url.slice(url.indexOf('/api/services/') + '/api/services/'.length));
          return answerService();
        }
        const { template } = templateRequestSchema.parse(JSON.parse(String(init?.body)));
        templates.push(template);
        return await answerTemplate(template);
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );

  return { serviceCalls, templates, fetchSpy };
}

describe('what the Home Assistant tools touch', () => {
  const saved = new Map<string, string | undefined>();
  let restoreFetch: (() => void) | undefined;

  beforeEach(() => {
    for (const name of HOME_ASSISTANT_ENV) {
      saved.set(name, process.env[name]);
    }
    process.env.HEY_JARVIS_HOME_ASSISTANT_URL = 'http://home-assistant.test';
    process.env.HEY_JARVIS_HOME_ASSISTANT_TOKEN = 'test-token';
  });

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
    for (const name of HOME_ASSISTANT_ENV) {
      const value = saved.get(name);
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  /** Calls a service against the fake house, and reads what the call reports as touched. */
  async function callService(domain: string, data: Record<string, unknown>, house = fakeHomeAssistant()) {
    restoreFetch = () => house.fetchSpy.mockRestore();
    const result = await executeTool(callIoTService, { domain, serviceId: 'turn_off', data });
    return { result, touched: readAffectedEntities(callIoTService.id, { domain, data }, result), house };
  }

  describe('a service call', () => {
    it('reaches the lights of an area it names, and not the speaker in it', async () => {
      const { result, touched, house } = await callService('light', { area_id: 'living_room' });

      expect(house.serviceCalls).toEqual(['light/turn_off']);
      expect(result.success).toBe(true);
      expect(touched).toEqual([
        { id: 'light.sofa_lamp', name: 'Sofa lamp' },
        { id: 'light.ceiling', name: 'Ceiling' },
      ]);
    });

    it('reaches everything in an area when the service is Home Assistant’s own', async () => {
      const { touched } = await callService('homeassistant', { area_id: ['living_room'] });

      expect(touched.map((entity) => entity.id)).toEqual([
        'light.sofa_lamp',
        'light.ceiling',
        'media_player.living_room',
      ]);
    });

    it('reaches the ids it names, as a list or as a comma-separated string', async () => {
      const asList = await callService('light', { entity_id: ['light.sofa_lamp', 'light.kitchen_spots'] });
      restoreFetch?.();
      const asString = await callService('light', { entity_id: 'light.sofa_lamp, light.kitchen_spots' });

      const expected = [
        { id: 'light.sofa_lamp', name: 'Sofa lamp' },
        { id: 'light.kitchen_spots', name: 'Kitchen spots' },
      ];
      expect(asList.touched).toEqual(expected);
      expect(asString.touched).toEqual(expected);
    });

    it('reaches the entities of a device it names', async () => {
      const { touched } = await callService('light', { device_id: 'kitchen-spots-device' });

      expect(touched).toEqual([{ id: 'light.kitchen_spots', name: 'Kitchen spots' }]);
    });

    it('reports nothing for "all", which is every light in the house rather than a few being worked on', async () => {
      const { touched, house } = await callService('light', { entity_id: 'all' });

      expect(touched).toEqual([]);
      expect(house.templates).toEqual([]);
    });

    it('still succeeds when its targets cannot be resolved', async () => {
      const house = fakeHomeAssistant(() => new Response('template error', { status: 400, statusText: 'Bad Request' }));
      const { result, touched } = await callService('light', { area_id: 'living_room' }, house);

      expect(result.success).toBe(true);
      expect(result.targets).toEqual([]);
      expect(touched).toEqual([]);
    });

    it('still succeeds when Home Assistant renders its targets as something else', async () => {
      const house = fakeHomeAssistant(() => new Response(JSON.stringify({ not: 'a list' })));
      const { result } = await callService('light', { area_id: 'living_room' }, house);

      expect(result.success).toBe(true);
      expect(result.targets).toEqual([]);
    });

    it('does not wait long on a slow resolution, since sir is waiting on the call', async () => {
      const house = fakeHomeAssistant(() => new Promise<Response>(() => {}));
      const startedAt = Date.now();
      const { result } = await callService('light', { area_id: 'living_room' }, house);

      expect(result.targets).toEqual([]);
      expect(Date.now() - startedAt).toBeLessThan(3_000);
    });

    it('still fails when the service call itself fails', async () => {
      const house = fakeHomeAssistant(undefined, () => new Response('no', { status: 500, statusText: 'Server Error' }));
      restoreFetch = () => house.fetchSpy.mockRestore();

      await expect(
        executeTool(callIoTService, { domain: 'light', serviceId: 'turn_off', data: { area_id: 'living_room' } }),
      ).rejects.toThrow('Home Assistant API error');
    });
  });

  describe('a lookup', () => {
    const sofaLamp = { id: 'light.sofa_lamp', name: 'Sofa lamp', area: 'Living Room', state: 'on' };

    it('touches the handful of entities it found', () => {
      expect(readAffectedEntities(findEntities.id, {}, { entities: [sofaLamp], totalMatches: 1 })).toEqual([
        { id: 'light.sofa_lamp', name: 'Sofa lamp' },
      ]);
    });

    it(`touches nothing when it matched more than ${MOST_ENTITIES_A_LOOKUP_AFFECTS}, which is a survey`, () => {
      const many = Array.from({ length: MOST_ENTITIES_A_LOOKUP_AFFECTS + 1 }, (_, index) => ({
        ...sofaLamp,
        id: `light.lamp_${index}`,
      }));

      expect(readAffectedEntities(findEntities.id, {}, { entities: many, totalMatches: many.length })).toEqual([]);
    });
  });

  describe('a logbook query', () => {
    it('touches the entity whose history it read, by the name the entries give it', () => {
      const logbook = {
        entityId: 'light.sofa_lamp',
        entries: [{ when: '2026-09-30T08:00:00Z', name: 'Sofa lamp', domain: 'light', state: 'on' }],
      };

      expect(readAffectedEntities(getEntityLogbook.id, { entityId: 'light.sofa_lamp' }, logbook)).toEqual([
        { id: 'light.sofa_lamp', name: 'Sofa lamp' },
      ]);
    });

    it('touches the entity even when its history was empty', () => {
      expect(
        readAffectedEntities(
          getEntityLogbook.id,
          { entityId: 'light.porch' },
          { entityId: 'light.porch', entries: [] },
        ),
      ).toEqual([{ id: 'light.porch' }]);
    });
  });
});
