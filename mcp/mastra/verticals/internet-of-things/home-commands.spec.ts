/**
 * Smart home commands carried out without the agent: when a classification is plain enough to act
 * on, and what Home Assistant is then asked.
 *
 * Declining is always safe -- the agent handles the request instead -- so most of what is pinned
 * here is that it declines whenever it is not sure. Home Assistant is faked at `fetch`, scoped to
 * each test, and given a made-up address.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import {
  describeHomeCommand,
  HOME_ACTIONS,
  type HomeCommand,
  homeCommandFrom,
  homeCommandQuestions,
  runHomeCommand,
} from './home-commands.js';

const livingRoom = { id: 'living_room', name: 'Living Room' };
const kitchen = { id: 'kitchen', name: 'Kitchen' };
const AREAS = [livingRoom, kitchen];
const SURE = 0.9;

function sure(choice: string, confidence = 0.97) {
  return { choice, probabilities: { [choice]: confidence } };
}

describe('homeCommandQuestions', () => {
  it('offers the everyday actions and every area, each with a way out', () => {
    const { homeAction, homeArea } = homeCommandQuestions(AREAS);

    expect(Object.keys(homeAction.criteria)).toEqual([...Object.keys(HOME_ACTIONS), 'other']);
    expect(homeArea.criteria).toEqual({
      living_room: 'Living Room',
      kitchen: 'Kitchen',
      everywhere: expect.any(String),
      unspecified: expect.any(String),
    });
  });
});

describe('homeCommandFrom', () => {
  it('aims a command it is sure of at the area it named', () => {
    expect(homeCommandFrom({ homeAction: sure('light.turn_off'), homeArea: sure('living_room') }, AREAS, SURE)).toEqual(
      { action: 'light.turn_off', area: livingRoom },
    );
  });

  it('aims a command at the whole home when that is what was asked', () => {
    expect(homeCommandFrom({ homeAction: sure('light.turn_off'), homeArea: sure('everywhere') }, AREAS, SURE)).toEqual({
      action: 'light.turn_off',
      area: undefined,
    });
  });

  it('leaves anything that is not an everyday action to the agent', () => {
    expect(homeCommandFrom({ homeAction: sure('other'), homeArea: sure('kitchen') }, AREAS, SURE)).toBeUndefined();
    expect(
      homeCommandFrom({ homeAction: sure('climate.set_temperature'), homeArea: sure('kitchen') }, AREAS, SURE),
    ).toBeUndefined();
  });

  it('leaves a command with no room named to the agent', () => {
    expect(
      homeCommandFrom({ homeAction: sure('light.turn_on'), homeArea: sure('unspecified') }, AREAS, SURE),
    ).toBeUndefined();
  });

  it('never aims at an area the home does not have', () => {
    expect(
      homeCommandFrom({ homeAction: sure('light.turn_on'), homeArea: sure('garage') }, AREAS, SURE),
    ).toBeUndefined();
  });

  it('leaves the command to the agent when either answer is unsure', () => {
    expect(
      homeCommandFrom({ homeAction: sure('light.turn_on', 0.6), homeArea: sure('kitchen') }, AREAS, SURE),
    ).toBeUndefined();
    expect(
      homeCommandFrom({ homeAction: sure('light.turn_on'), homeArea: sure('kitchen', 0.6) }, AREAS, SURE),
    ).toBeUndefined();
    expect(
      homeCommandFrom({ homeAction: { choice: 'light.turn_on' }, homeArea: sure('kitchen') }, AREAS, SURE),
    ).toBeUndefined();
  });
});

describe('describeHomeCommand', () => {
  it('says what was done and where, in words that can be spoken', () => {
    expect(describeHomeCommand({ action: 'light.turn_on', area: kitchen })).toBe('Turn lights on in the Kitchen');
    expect(describeHomeCommand({ action: 'cover.close_cover', area: undefined })).toBe(
      'Close the blinds, curtains, shutters or garage door everywhere in the home',
    );
  });
});

describe('runHomeCommand', () => {
  const HOME_ASSISTANT_ENV = ['HEY_JARVIS_HOME_ASSISTANT_URL', 'HEY_JARVIS_HOME_ASSISTANT_TOKEN'] as const;
  const saved = new Map<string, string | undefined>();
  const requests: { url: string; body: unknown }[] = [];
  let respondWith: () => Response;
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>> | undefined;

  beforeEach(() => {
    for (const name of HOME_ASSISTANT_ENV) {
      saved.set(name, process.env[name]);
    }
    process.env.HEY_JARVIS_HOME_ASSISTANT_URL = 'http://home-assistant.test';
    process.env.HEY_JARVIS_HOME_ASSISTANT_TOKEN = 'test-token';
    requests.length = 0;
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(
        async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
          requests.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) });
          return respondWith();
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  const lightsOffInKitchen: HomeCommand = { action: 'light.turn_off', area: kitchen };

  it('calls the service on the area, and says how many devices changed', async () => {
    respondWith = () => new Response(JSON.stringify([{ entity_id: 'light.a' }, { entity_id: 'light.b' }]));

    const text = await runHomeCommand(lightsOffInKitchen);

    expect(requests).toEqual([
      { url: 'http://home-assistant.test/api/services/light/turn_off', body: { area_id: 'kitchen' } },
    ]);
    expect(text).toBe('Done: Turn lights off in the Kitchen. 2 devices changed state.');
  });

  it('targets every entity of the kind when the command is for the whole home', async () => {
    respondWith = () => new Response('[]');

    await runHomeCommand({ action: 'cover.open_cover', area: undefined });

    expect(requests[0]).toEqual({
      url: 'http://home-assistant.test/api/services/cover/open_cover',
      body: { entity_id: 'all' },
    });
  });

  it('does not claim success when nothing changed', async () => {
    respondWith = () => new Response('[]');

    expect(await runHomeCommand(lightsOffInKitchen)).toContain('nothing changed state');
  });

  it('throws when Home Assistant refuses, so the agent can take over', async () => {
    respondWith = () => new Response('Service not found', { status: 400, statusText: 'Bad Request' });

    await expect(runHomeCommand(lightsOffInKitchen)).rejects.toThrow('Service not found');
  });
});
