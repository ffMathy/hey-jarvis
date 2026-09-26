/**
 * The lookups that stand between a request and the service call that answers it.
 *
 * "Turn off the living room lights" is judged by how soon the lights change, so these pin what
 * keeps that short: the areas are served from a cache rather than asked for on every request,
 * a lookup filtered to a domain renders only that domain, device IDs are reused between calls,
 * and `findEntities` hands the agent a short list rather than every attribute in the house.
 *
 * Home Assistant is faked at `fetch`, scoped to each test, and given a made-up address.
 */

import { afterEach, beforeEach, describe, expect, it, setSystemTime, spyOn } from 'bun:test';
import { z } from 'zod';
import { executeTool } from '../../utils/tool-factory.js';
import { describeAreas } from './agent.js';
import {
  type EntitySummary,
  filterEntities,
  findEntities,
  getAllDevices,
  getHomeAreas,
  normalizeDomain,
  resetHomeAssistantCachesForTest,
} from './tools.js';

const templateRequestSchema = z.object({ template: z.string() });

const HOME_ASSISTANT_ENV = ['HEY_JARVIS_HOME_ASSISTANT_URL', 'HEY_JARVIS_HOME_ASSISTANT_TOKEN'] as const;

/**
 * A stand-in for `fetch` that hands each request's body to `handle`.
 *
 * Bun's `fetch` carries a `preconnect` function as well as its call signature, so a bare
 * function is not one; the real `preconnect` is carried over to make it whole.
 */
function fakeFetch(handle: (body: string) => Response): typeof fetch {
  return Object.assign(
    async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      handle(String(init?.body ?? '{}')),
    { preconnect: globalThis.fetch.preconnect },
  );
}

/** Answers each template render with whatever `respond` returns for its source. */
function fakeHomeAssistant(respond: (template: string) => unknown) {
  const templates: string[] = [];
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    fakeFetch((body) => {
      const { template } = templateRequestSchema.parse(JSON.parse(body));
      templates.push(template);
      return new Response(JSON.stringify(respond(template)));
    }),
  );

  return { templates, fetchSpy };
}

const livingRoom = { id: 'living_room', name: 'Living Room' };
const kitchen = { id: 'kitchen', name: 'Kitchen' };

describe('Home Assistant lookups', () => {
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
    setSystemTime();
  });

  describe('getHomeAreas', () => {
    it('asks Home Assistant once and then answers from the cache', async () => {
      const { fetchSpy } = fakeHomeAssistant(() => [livingRoom, kitchen]);

      expect(await getHomeAreas()).toEqual([livingRoom, kitchen]);
      expect(await getHomeAreas()).toEqual([livingRoom, kitchen]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      fetchSpy.mockRestore();
    });

    it('answers a stale list at once and refreshes it behind the request', async () => {
      setSystemTime(new Date('2026-09-26T08:00:00Z'));
      let areas = [livingRoom];
      const { fetchSpy } = fakeHomeAssistant(() => areas);
      await getHomeAreas();

      setSystemTime(new Date('2026-09-26T08:30:00Z'));
      areas = [livingRoom, kitchen];
      expect(await getHomeAreas()).toEqual([livingRoom]);

      // The refresh was started, not awaited; once it lands the next request sees it.
      await Bun.sleep(10);
      expect(await getHomeAreas()).toEqual([livingRoom, kitchen]);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      fetchSpy.mockRestore();
    });

    it('gives up on an unreachable Home Assistant without asking again on every request', async () => {
      const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
        fakeFetch(() => new Response('nope', { status: 500, statusText: 'Internal Server Error' })),
      );

      expect(await getHomeAreas()).toEqual([]);
      expect(await getHomeAreas()).toEqual([]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      fetchSpy.mockRestore();
    });
  });

  describe('describeAreas', () => {
    it('lists every area with the id a service call targets it by', () => {
      const described = describeAreas([livingRoom, kitchen]);

      expect(described).toContain('- Living Room: area_id "living_room"');
      expect(described).toContain('- Kitchen: area_id "kitchen"');
    });

    it('says nothing when there are no areas to list', () => {
      expect(describeAreas([])).toBe('');
    });
  });

  describe('getAllDevices', () => {
    it('renders only the devices in the domain asked for, and reuses their IDs', async () => {
      const { templates, fetchSpy } = fakeHomeAssistant((template) =>
        template.includes("map('device_id')") ? ['lamp-device'] : [],
      );

      await executeTool(getAllDevices, { domain: 'Light' });
      await executeTool(getAllDevices, { domain: 'Light' });

      const idLookups = templates.filter((template) => template.includes("map('device_id')"));
      expect(idLookups).toEqual([
        "{{ states.light|map(attribute='entity_id')|map('device_id')|unique|reject('eq',None)|list|to_json }}",
      ]);
      expect(templates.filter((template) => template.includes('device_entities'))).toHaveLength(2);
      fetchSpy.mockRestore();
    });
  });

  describe('findEntities', () => {
    const entities: EntitySummary[] = [
      { id: 'light.sofa_lamp', name: 'Sofa lamp', area: 'Living Room', state: 'on' },
      { id: 'light.ceiling', name: 'Ceiling', area: 'Living Room', state: 'off' },
      { id: 'light.kitchen_spots', name: 'Kitchen spots', area: 'Kitchen', state: 'on' },
      { id: 'light.porch', name: 'Porch', area: null, state: 'off' },
    ];

    it('lists the entities of a domain in an area, without their attributes', async () => {
      const { templates, fetchSpy } = fakeHomeAssistant((template) =>
        template.startsWith('{{ states.light') ? entities.map((entity) => entity.id) : entities,
      );

      const found = await executeTool(findEntities, { domain: 'light', area: 'living room' });

      expect(found).toEqual({ entities: entities.slice(0, 2), totalMatches: 2 });
      expect(templates[0]).toBe("{{ states.light|map(attribute='entity_id')|list|to_json }}");
      fetchSpy.mockRestore();
    });

    it('matches areas and names by any part of them, in any case', () => {
      expect(filterEntities(entities, { area: 'KITCHEN' }).map((entity) => entity.id)).toEqual(['light.kitchen_spots']);
      expect(filterEntities(entities, { search: 'lamp' }).map((entity) => entity.id)).toEqual(['light.sofa_lamp']);
      expect(filterEntities(entities, {})).toEqual(entities);
    });
  });

  describe('normalizeDomain', () => {
    it('accepts a domain however it is capitalised', () => {
      expect(normalizeDomain(' Light ')).toBe('light');
      expect(normalizeDomain('media_player')).toBe('media_player');
    });

    it('refuses anything that would be template syntax rather than a name', () => {
      expect(() => normalizeDomain("light' or true or '")).toThrow('is not a Home Assistant domain');
    });
  });
});
