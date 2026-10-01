/**
 * Smart home commands carried out without the agent: the services and entities Jev is offered,
 * when its answers are plain enough to act on, and what Home Assistant is then asked.
 *
 * Declining is always safe -- the agent handles the request instead -- so most of what is pinned
 * here is that it declines whenever it is not sure. Home Assistant is faked at `fetch`, scoped to
 * each test, and given a made-up address.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { Classifier } from '@mastra/core/classifier';
import {
  answerHomeQuestion,
  describeEntities,
  entitiesFrom,
  entityQuestions,
  type HomeService,
  homeQuestionDomainFrom,
  homeQuestionQuestions,
  homeServiceFrom,
  homeServiceQuestions,
  homeServicesFrom,
  runHomeCommand,
} from './home-commands.js';
import { type EntitySummary, MOST_ENTITIES_A_LOOKUP_AFFECTS, resetHomeAssistantCachesForTest } from './tools.js';

const SURE = 0.85;

const lightTurnOff: HomeService = {
  id: 'light.turn_off',
  domain: 'light',
  service: 'turn_off',
  description: 'Turn off: Turns off one or more lights.',
  requiredFields: [],
  entityDomains: ['light'],
};

const climateSetTemperature: HomeService = {
  id: 'climate.set_temperature',
  domain: 'climate',
  service: 'set_temperature',
  description: 'Set target temperature',
  requiredFields: ['temperature'],
  entityDomains: ['climate'],
};

const SERVICES = [lightTurnOff, climateSetTemperature];

const kitchenLight = { id: 'light.kitchen', name: 'Kitchen ceiling', area: 'Kitchen', state: 'on' };
const sofaLamp = { id: 'light.sofa', name: 'Sofa lamp', area: 'Living Room', state: 'on' };
const ENTITIES = [kitchenLight, sofaLamp];

describe('homeServicesFrom', () => {
  it('keeps the services that act on entities, with what a call needs', () => {
    const services = homeServicesFrom([
      {
        domain: 'light',
        services: {
          turn_off: {
            name: 'Turn off',
            description: 'Turns off one or more lights.',
            fields: { transition: { required: false } },
            target: { entity: [{ domain: ['light'] }] },
          },
          reload: { name: 'Reload', description: 'Reloads lights.' },
        },
      },
      {
        domain: 'climate',
        services: {
          set_temperature: {
            name: 'Set target temperature',
            fields: { temperature: { required: true } },
            target: { entity: { domain: 'climate' } },
          },
        },
      },
      {
        domain: 'homeassistant',
        services: { turn_off: { name: 'Generic turn off', target: { entity: {} } } },
      },
      { domain: 'update', services: { install: { target: { entity: [{ domain: ['update'] }] } } } },
    ]);

    expect(services).toEqual([
      lightTurnOff,
      climateSetTemperature,
      {
        id: 'homeassistant.turn_off',
        domain: 'homeassistant',
        service: 'turn_off',
        description: 'Generic turn off',
        requiredFields: [],
        entityDomains: ['homeassistant'],
      },
    ]);
  });
});

describe('homeServiceQuestions', () => {
  it('offers every service by its own description, with a way out', () => {
    const { homeService } = homeServiceQuestions(SERVICES);

    expect(homeService.criteria).toEqual({
      'light.turn_off': 'Turn off: Turns off one or more lights.',
      'climate.set_temperature': 'Set target temperature',
      other: expect.any(String),
    });
  });
});

describe('homeServiceFrom', () => {
  function answers(choice: string, confidence: number, givesSetting = 0.02) {
    return {
      homeService: { choice, probabilities: { [choice]: confidence } },
      homeCommandGivesSetting: { probability: givesSetting },
    };
  }

  it('takes a service it is sure of', () => {
    expect(homeServiceFrom(answers('light.turn_off', 0.95), SERVICES, SURE)).toBe(lightTurnOff);
  });

  it('leaves it to the agent when it is unsure, or the answer is other', () => {
    expect(homeServiceFrom(answers('light.turn_off', 0.6), SERVICES, SURE)).toBeUndefined();
    expect(homeServiceFrom(answers('other', 0.99), SERVICES, SURE)).toBeUndefined();
  });

  it('leaves a command that gives a setting to the agent, which can write the value', () => {
    expect(homeServiceFrom(answers('light.turn_off', 0.95, 0.4), SERVICES, SURE)).toBeUndefined();
  });

  it('never calls a service that needs a value nothing here can write', () => {
    expect(homeServiceFrom(answers('climate.set_temperature', 0.99), SERVICES, SURE)).toBeUndefined();
  });
});

describe('entitiesFrom', () => {
  it('takes every entity it is sure the command acts on', () => {
    expect(entitiesFrom({ entity0: { probability: 0.97 }, entity1: { probability: 0.03 } }, ENTITIES, SURE)).toEqual([
      kitchenLight,
    ]);
  });

  it('leaves the command to the agent when any entity is uncertain', () => {
    expect(
      entitiesFrom({ entity0: { probability: 0.97 }, entity1: { probability: 0.5 } }, ENTITIES, SURE),
    ).toBeUndefined();
  });

  it('leaves the command to the agent when it acts on nothing, or an answer is missing', () => {
    expect(
      entitiesFrom({ entity0: { probability: 0.01 }, entity1: { probability: 0.02 } }, ENTITIES, SURE),
    ).toBeUndefined();
    expect(entitiesFrom({ entity0: { probability: 0.97 } }, ENTITIES, SURE)).toBeUndefined();
  });
});

describe('entityQuestions', () => {
  it('asks about each entity by name, area and state', () => {
    const questions = entityQuestions('Should it act on', ENTITIES);

    expect(Object.keys(questions)).toEqual(['entity0', 'entity1']);
    expect(questions.entity0?.instructions).toContain(
      'Kitchen ceiling (light.kitchen), in Kitchen, which is currently on',
    );
  });
});

describe('homeQuestionQuestions', () => {
  it('offers each domain in words where it can, with a way out', () => {
    const { homeQuestionDomain } = homeQuestionQuestions(['lock', 'camera']);

    expect(homeQuestionDomain.criteria).toEqual({ lock: 'Door locks', camera: 'camera', other: expect.any(String) });
  });
});

describe('homeQuestionDomainFrom', () => {
  function answers(choice: string, confidence: number, aboutNow = 0.97) {
    return {
      homeQuestionDomain: { choice, probabilities: { [choice]: confidence } },
      homeQuestionIsAboutNow: { probability: aboutNow },
    };
  }

  it('takes a domain it is sure of, for a question about now', () => {
    expect(homeQuestionDomainFrom(answers('lock', 0.95), ['lock'], SURE)).toBe('lock');
  });

  it('leaves history, unsure answers and unknown domains to the agent', () => {
    expect(homeQuestionDomainFrom(answers('lock', 0.95, 0.3), ['lock'], SURE)).toBeUndefined();
    expect(homeQuestionDomainFrom(answers('lock', 0.6), ['lock'], SURE)).toBeUndefined();
    expect(homeQuestionDomainFrom(answers('garage', 0.99), ['lock'], SURE)).toBeUndefined();
  });
});

describe('describeEntities', () => {
  it('lists each entity with its area, state and unit, for the voice model to phrase', () => {
    expect(
      describeEntities([
        { id: 'sensor.living_temp', name: 'Living room temperature', area: 'Living Room', state: '21.5', unit: '°C' },
        { id: 'lock.front', name: 'Front door', area: null, state: 'locked' },
      ]),
    ).toBe('Living room temperature (Living Room): 21.5 °C\nFront door: locked');
  });
});

describe('runHomeCommand', () => {
  const HOME_ASSISTANT_ENV = ['HEY_JARVIS_HOME_ASSISTANT_URL', 'HEY_JARVIS_HOME_ASSISTANT_TOKEN'] as const;
  const saved = new Map<string, string | undefined>();
  const serviceCalls: { url: string; body: unknown }[] = [];
  let serviceResponse: () => Response;
  /** The entities the house lists, which is {@link ENTITIES} unless a test furnishes it otherwise. */
  let houseEntities: EntitySummary[] = ENTITIES;
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>> | undefined;

  /** Home Assistant, answering the entity listing and recording every service call. */
  beforeEach(() => {
    for (const name of HOME_ASSISTANT_ENV) {
      saved.set(name, process.env[name]);
    }
    process.env.HEY_JARVIS_HOME_ASSISTANT_URL = 'http://home-assistant.test';
    process.env.HEY_JARVIS_HOME_ASSISTANT_TOKEN = 'test-token';
    resetHomeAssistantCachesForTest();
    serviceCalls.length = 0;
    houseEntities = ENTITIES;

    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(
        async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
          const url = String(input);
          const body: unknown = JSON.parse(String(init?.body ?? '{}'));
          if (url.endsWith('/api/template')) {
            const template = JSON.stringify(body);
            return new Response(
              JSON.stringify(
                template.includes('map(attribute') ? houseEntities.map((entity) => entity.id) : houseEntities,
              ),
            );
          }
          serviceCalls.push({ url, body });
          return serviceResponse();
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    resetHomeAssistantCachesForTest();
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  /** A classifier whose model answers every entity question with the given probabilities, in order. */
  function classifierAnswering(probabilities: number[]) {
    return new Classifier({
      id: 'homeCommandClassifier',
      model: {
        specificationVersion: 'v4',
        provider: 'fake',
        modelId: 'jev-fake',
        supportedQuestionTypes: ['boolean'],
        doEvaluate: async ({ questions }) => ({
          answers: Object.fromEntries(
            Object.keys(questions).map((key, index) => [
              key,
              { type: 'boolean' as const, probability: probabilities[index] ?? 0 },
            ]),
          ),
          warnings: [],
        }),
      },
    });
  }

  it('calls the service on the entities Jev chose, and says how many changed', async () => {
    serviceResponse = () => new Response(JSON.stringify([{ entity_id: 'light.kitchen' }]));

    const outcome = await runHomeCommand(
      'turn off the kitchen lights',
      lightTurnOff,
      SURE,
      classifierAnswering([0.97, 0.02]),
    );

    expect(serviceCalls).toEqual([
      { url: 'http://home-assistant.test/api/services/light/turn_off', body: { entity_id: ['light.kitchen'] } },
    ]);
    expect(outcome?.text).toContain('Kitchen ceiling');
    expect(outcome?.text).toContain('1 device changed state');
  });

  // No agent runs, so no `callIoTService` result reports what the call reached: this does instead,
  // or a command taking this path would never light anything up on sir's headset.
  it('reports the entities it called the service on, by id and name, for the headset to light up', async () => {
    serviceResponse = () => new Response(JSON.stringify([{ entity_id: 'light.kitchen' }]));

    const outcome = await runHomeCommand(
      'turn off the kitchen lights',
      lightTurnOff,
      SURE,
      classifierAnswering([0.97, 0.02]),
    );

    expect(outcome?.entities).toEqual([{ id: 'light.kitchen', name: 'Kitchen ceiling' }]);
  });

  it('does not claim success when nothing changed', async () => {
    serviceResponse = () => new Response('[]');

    const outcome = await runHomeCommand(
      'turn off the kitchen lights',
      lightTurnOff,
      SURE,
      classifierAnswering([0.97, 0.02]),
    );

    expect(outcome?.text).toContain('nothing changed state');
    // Still the thing it worked on, changed or not, as a service call the agent made would report.
    expect(outcome?.entities).toEqual([{ id: 'light.kitchen', name: 'Kitchen ceiling' }]);
  });

  it('declines without calling anything when Jev is unsure of an entity', async () => {
    serviceResponse = () => new Response('[]');

    expect(
      await runHomeCommand('turn off some lights', lightTurnOff, SURE, classifierAnswering([0.97, 0.5])),
    ).toBeUndefined();
    expect(serviceCalls).toEqual([]);
  });

  it('answers a question from the states of the entities Jev chose, calling no service', async () => {
    const outcome = await answerHomeQuestion(
      'is the kitchen light on',
      'light',
      SURE,
      classifierAnswering([0.97, 0.02]),
    );

    expect(outcome?.text).toBe('Kitchen ceiling (Kitchen): on');
    expect(serviceCalls).toEqual([]);
  });

  // No agent runs, so no `findEntities` result reports what the question was about: this does
  // instead, or "what lights are on in the kitchen" answered this way would light nothing up.
  it('reports the entities a question was about, by id and name, for the headset to light up', async () => {
    const outcome = await answerHomeQuestion(
      'what lights are on in the kitchen',
      'light',
      SURE,
      classifierAnswering([0.97, 0.02]),
    );

    expect(outcome?.entities).toEqual([{ id: 'light.kitchen', name: 'Kitchen ceiling' }]);
  });

  it(`reports nothing for a question about more than ${MOST_ENTITIES_A_LOOKUP_AFFECTS} entities, as findEntities would not`, async () => {
    houseEntities = Array.from({ length: MOST_ENTITIES_A_LOOKUP_AFFECTS + 1 }, (_, index) => ({
      id: `light.number_${index}`,
      name: `Light ${index}`,
      area: 'Hall',
      state: 'on',
    }));

    const outcome = await answerHomeQuestion(
      'are any lights on',
      'light',
      SURE,
      classifierAnswering(houseEntities.map(() => 0.97)),
    );

    // Still answered, every light in it -- only the glow is left out, since lighting up the whole
    // house tells sir nothing.
    expect(outcome?.text.split('\n')).toHaveLength(MOST_ENTITIES_A_LOOKUP_AFFECTS + 1);
    expect(outcome?.entities).toEqual([]);
  });

  it('leaves a question to the agent when Jev is unsure which entity it is about', async () => {
    expect(await answerHomeQuestion('is a light on', 'light', SURE, classifierAnswering([0.6, 0.02]))).toBeUndefined();
  });

  it('declines when there is no classifier', async () => {
    expect(await runHomeCommand('turn off the lights', lightTurnOff, SURE, undefined)).toBeUndefined();
  });

  it('throws when Home Assistant refuses, so the agent can take over', async () => {
    serviceResponse = () => new Response('Service not found', { status: 400, statusText: 'Bad Request' });

    await expect(
      runHomeCommand('turn off the kitchen lights', lightTurnOff, SURE, classifierAnswering([0.97, 0.02])),
    ).rejects.toThrow('Service not found');
  });
});
