/**
 * A light switched by voice, from Jarvis's side of the line, with sir's headset watching.
 *
 * This is the path the ElevenLabs agent takes, through the same two MCP tools it calls:
 * `routePromptWorkflow` with what sir said, then `getNextInstructionsWorkflow` until a response
 * closes the request. In between, the planner hands the request to the Internet of Things agent,
 * which looks the lights up and then switches them off -- and the headset is to light up each thing
 * while that is happening, which means the poll has to hear about it from the tool results the
 * agent streams, long before the agent answers.
 *
 * That join is Mastra's undocumented chunk shape -- an agent step forwarding its agent's
 * `tool-result` chunks into the plan run as `workflow-step-output` -- and the controller spec only
 * feeds it chunks built by hand. A mismatch would be silent: the request would run and answer, and
 * nothing would ever glow. So it is pinned here against a real plan run, with scripted models and
 * Home Assistant faked at `fetch`.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { Mastra } from '@mastra/core';
import { InMemoryStore } from '@mastra/core/storage';
import { z } from 'zod';
import { createScriptedModel } from '../../../tests/utils/scripted-model.js';
import { markAsAffectingEntities } from '../../utils/affected-entities.js';
import { createAgent } from '../../utils/agent-factory.js';
import { createInstructionsWorkflowTool, createSimplifiedWorkflowTool } from '../../utils/mcp-tool-factory.js';
import { createTool, executeTool } from '../../utils/tool-factory.js';
import { callIoTService, findEntities } from '../internet-of-things/tools.js';
import { resetRoutingRuntime } from './controller.js';
import { PLANNER_AGENT_ID } from './planner.js';
import {
  getNextInstructionsWorkflow,
  instructionsOutputSchema,
  MARK_AFFECTED_INSTRUCTIONS,
  resetPollDeadlineForTest,
  routePromptWorkflow,
  setPollDeadlineForTest,
} from './workflows.js';

const REQUEST = 'Turn off the kitchen lights and the pantry light.';
const ANSWER = 'Turned off the kitchen lights and the pantry light.';

/** The lights of the fake house, as Home Assistant names them. */
const LIGHTS = [
  { id: 'light.kitchen_ceiling', name: 'Kitchen ceiling', area: 'Kitchen', state: 'on' },
  { id: 'light.kitchen_spots', name: 'Kitchen spots', area: 'Kitchen', state: 'on' },
  { id: 'light.pantry', name: 'Pantry', area: 'Pantry', state: 'on' },
];

const templateRequestSchema = z.object({ template: z.string() });

const HOME_ASSISTANT_ENV = ['HEY_JARVIS_HOME_ASSISTANT_URL', 'HEY_JARVIS_HOME_ASSISTANT_TOKEN'] as const;

/** Everything else a plan has to write out, left empty: no answers, and nothing about a photo. */
const NOTHING_ELSE_PLANNED = { answers: [], dismissedPhotoIds: [], photosToAskAbout: [], awaitsPhoto: false };

/** The planner: one task for the Internet of Things agent, answered as a command. */
function scriptedPlanner() {
  return createScriptedModel(() => ({
    text: JSON.stringify({
      responseStyle: 'command',
      tasks: [{ id: 'lights', agentId: 'internetOfThings', prompt: REQUEST, needs: '' }],
      ...NOTHING_ELSE_PLANNED,
    }),
  }));
}

/**
 * The Internet of Things agent: looks up the kitchen lights, switches them and the pantry light off
 * in one call, and says so.
 */
function scriptedInternetOfThingsAgent() {
  return createScriptedModel(({ index }) => {
    if (index === 1) {
      return { toolCalls: [{ toolName: 'findEntities', input: { domain: 'light', area: 'kitchen' } }] };
    }
    if (index === 2) {
      return {
        toolCalls: [
          {
            toolName: 'callIoTService',
            input: {
              domain: 'light',
              serviceId: 'turn_off',
              data: { entity_id: ['light.kitchen_ceiling', 'light.kitchen_spots', 'light.pantry'] },
            },
          },
        ],
      };
    }
    return { text: ANSWER };
  });
}

/**
 * Answers the templates `findEntities` and the service call's target resolution render, from
 * {@link LIGHTS}, and holds the service call itself until the test lets it through.
 *
 * Holding it is what separates the two moments this is about: the lookup's result arrives while
 * the agent is still working, and the service call's afterwards.
 */
function fakeHomeAssistant() {
  let letServiceCallThrough: () => void = () => {};
  const serviceCallAllowed = new Promise<void>((resolve) => {
    letServiceCallThrough = resolve;
  });

  const answerTemplate = (template: string): unknown => {
    if (template.startsWith('{{ states.light')) {
      return LIGHTS.map((light) => light.id);
    }
    const targetedIds = template.match(/namespace\(ids=(\[[^\]]*\])/)?.[1];
    if (targetedIds) {
      const ids = z.array(z.string()).parse(JSON.parse(targetedIds));
      return LIGHTS.filter((light) => ids.includes(light.id)).map(({ id, name }) => ({ id, name }));
    }
    return LIGHTS;
  };

  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        if (String(input).includes('/api/services/')) {
          await serviceCallAllowed;
          return new Response('[]');
        }
        const { template } = templateRequestSchema.parse(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify(answerTemplate(template)));
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );

  return { letServiceCallThrough, fetchSpy };
}

/** An agent on a scripted model, without the shared memory that would want real credentials. */
async function scriptedAgent(id: string, model: ReturnType<typeof createScriptedModel>['model'], extra = {}) {
  return createAgent({ id, name: id, instructions: `You are ${id}.`, model, memory: undefined, ...extra });
}

const routeTool = createInstructionsWorkflowTool(routePromptWorkflow);
const pollTool = createSimplifiedWorkflowTool(getNextInstructionsWorkflow);

/** One poll, read the way the voice agent reads it. */
async function poll() {
  return instructionsOutputSchema.parse(await executeTool(pollTool, {}));
}

/** The openings a response has when it closes a request, wherever in it they come. */
const CLOSING_OPENINGS = ['All tasks have completed', 'The request could not be completed'];

const saved = new Map<string, string | undefined>();
let restoreFetch: (() => void) | undefined;

beforeEach(async () => {
  for (const name of HOME_ASSISTANT_ENV) {
    saved.set(name, process.env[name]);
  }
  process.env.HEY_JARVIS_HOME_ASSISTANT_URL = 'http://home-assistant.test';
  process.env.HEY_JARVIS_HOME_ASSISTANT_TOKEN = 'test-token';

  resetRoutingRuntime();
  // Long enough that a poll is woken by what it waits for rather than by running out; the real
  // runtime wakes it the moment a tool reports something.
  setPollDeadlineForTest(5_000);

  // Registering the workflows here is what hands their steps this instance: the routing steps
  // plan against its agents.
  new Mastra({
    storage: new InMemoryStore(),
    logger: false,
    workflows: { routePromptWorkflow, getNextInstructionsWorkflow },
    agents: {
      [PLANNER_AGENT_ID]: await scriptedAgent(PLANNER_AGENT_ID, scriptedPlanner().model),
      internetOfThings: await scriptedAgent('internetOfThings', scriptedInternetOfThingsAgent().model, {
        tools: { findEntities, callIoTService },
      }),
    },
  });
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
  resetRoutingRuntime();
  resetPollDeadlineForTest();
  for (const name of HOME_ASSISTANT_ENV) {
    const value = saved.get(name);
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe('a light switched by voice, with the headset watching', () => {
  it('hands the first poll what the agent has looked up, while it is still working', async () => {
    const house = fakeHomeAssistant();
    restoreFetch = () => house.fetchSpy.mockRestore();

    await executeTool(routeTool, { userQuery: REQUEST, async: false });

    // The first response that says anything at all. A poll that runs out its deadline while the
    // planner is still at work says only that, and is not the one this is about.
    let first = await poll();
    for (let attempt = 0; attempt < 10 && first.instructions.startsWith('Still processing'); attempt += 1) {
      first = await poll();
    }

    expect(first.affectedEntities).toEqual([
      { id: 'light.kitchen_ceiling', name: 'Kitchen ceiling' },
      { id: 'light.kitchen_spots', name: 'Kitchen spots' },
    ]);
    expect(first.instructions).toStartWith(MARK_AFFECTED_INSTRUCTIONS);
    expect(first.instructions).toContain('call getNextInstructionsWorkflow again at once');
    expect(first.completedTaskResults).toBeUndefined();
    expect(first.taskIdsInProgress).toEqual(['lights']);

    house.letServiceCallThrough();

    // Whether the service call's targets come in a response of their own or with the closing one
    // depends on how soon the agent answers after the call, so every response is read until the
    // request closes.
    const laterResponses = [await poll()];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const latest = laterResponses[laterResponses.length - 1];
      if (CLOSING_OPENINGS.some((opening) => latest.instructions.includes(opening))) {
        break;
      }
      laterResponses.push(await poll());
    }
    const closing = laterResponses[laterResponses.length - 1];
    const reportedLater = laterResponses.filter((response) => response.affectedEntities);

    expect(closing.instructions).toContain('All tasks have completed');
    expect(closing.completedTaskResults).toEqual([{ id: 'lights', result: ANSWER }]);
    // The service call reached one light the lookup had not, and only that one is new.
    expect(reportedLater.flatMap((response) => response.affectedEntities ?? [])).toEqual([
      { id: 'light.pantry', name: 'Pantry' },
    ]);
    // The first things touched had a response of their own; the pantry never does, and rides on the
    // agent's answer instead -- a response with nothing else would cost the voice model a step.
    for (const response of reportedLater) {
      expect(response.instructions).toStartWith(MARK_AFFECTED_INSTRUCTIONS);
      expect(response.completedTaskResults).toEqual([{ id: 'lights', result: ANSWER }]);
    }
  }, 60_000);

  it('answers a quick command in one response, with everything it touched', async () => {
    const house = fakeHomeAssistant();
    restoreFetch = () => house.fetchSpy.mockRestore();
    // The house answers at once, so the agent's answer lands inside the window the first things
    // touched are held for -- the usual shape of a command on a phone, which lights nothing up.
    house.letServiceCallThrough();

    await executeTool(routeTool, { userQuery: REQUEST, async: false });

    let first = await poll();
    for (let attempt = 0; attempt < 10 && first.instructions.startsWith('Still processing'); attempt += 1) {
      first = await poll();
    }

    expect(first.affectedEntities).toEqual([
      { id: 'light.kitchen_ceiling', name: 'Kitchen ceiling' },
      { id: 'light.kitchen_spots', name: 'Kitchen spots' },
      { id: 'light.pantry', name: 'Pantry' },
    ]);
    expect(first.completedTaskResults).toEqual([{ id: 'lights', result: ANSWER }]);
    expect(first.instructions).toStartWith(MARK_AFFECTED_INSTRUCTIONS);
    expect(first.instructions).not.toContain('Nothing has finished yet');
  }, 60_000);
});

/**
 * An answer to a question is not part of any plan run: it resumes the agent that asked, and routing
 * reads that agent's own stream instead (see `resumeWithAnswer`). What the resumed tool touches has
 * to reach the poll from there too.
 */
describe('a lamp chosen by answering the question that asked which', () => {
  const QUESTION = 'Which lamp should I turn on?';
  const CHOICE = 'The sofa lamp.';

  const chosenLampSchema = z.object({ lamp: z.object({ id: z.string(), name: z.string() }) });

  /** Asks which lamp, and turns on the one sir names. */
  const chooseLamp = markAsAffectingEntities(
    createTool({
      id: 'chooseLamp',
      description: 'Asks which lamp to turn on, and turns it on',
      inputSchema: z.object({}),
      outputSchema: chosenLampSchema,
      suspendSchema: z.object({ question: z.string() }),
      resumeSchema: z.object({ userAnswer: z.string() }),
      execute: async (_inputData, context) => {
        if (!context.agent?.resumeData) {
          return await context.agent?.suspend({ question: QUESTION });
        }
        return { lamp: { id: 'light.sofa_lamp', name: 'Sofa lamp' } };
      },
    }),
    (_toolArguments, toolResult) => [chosenLampSchema.parse(toolResult).lamp],
  );

  /** The planner: a task for the request, and an answer for the reply to its question. */
  function scriptedPlannerWithAnswers() {
    return createScriptedModel(({ transcript }) => {
      const waitingQuestionId = transcript.match(/id "(q\d+)", asked by/)?.[1];
      if (waitingQuestionId && transcript.includes(CHOICE)) {
        return {
          text: JSON.stringify({
            responseStyle: 'command',
            tasks: [],
            ...NOTHING_ELSE_PLANNED,
            answers: [{ questionId: waitingQuestionId, answer: CHOICE }],
          }),
        };
      }
      return {
        text: JSON.stringify({
          responseStyle: 'command',
          tasks: [{ id: 'lamp', agentId: 'internetOfThings', prompt: 'Turn on a lamp.', needs: '' }],
          ...NOTHING_ELSE_PLANNED,
        }),
      };
    });
  }

  /** Polls until a response closes the request, the way the voice agent does. */
  async function pollUntilClosed() {
    const responses = [await poll()];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const latest = responses[responses.length - 1];
      if ([...CLOSING_OPENINGS, 'Part of this request'].some((opening) => latest.instructions.includes(opening))) {
        break;
      }
      responses.push(await poll());
    }
    return responses;
  }

  it('reaches the poll from the resumed agent’s own stream', async () => {
    resetRoutingRuntime();
    new Mastra({
      storage: new InMemoryStore(),
      logger: false,
      workflows: { routePromptWorkflow, getNextInstructionsWorkflow },
      agents: {
        [PLANNER_AGENT_ID]: await scriptedAgent(PLANNER_AGENT_ID, scriptedPlannerWithAnswers().model),
        internetOfThings: await scriptedAgent(
          'internetOfThings',
          createScriptedModel(({ transcript }) =>
            transcript.includes('light.sofa_lamp')
              ? { text: 'Turned on the sofa lamp.' }
              : { toolCalls: [{ toolName: 'chooseLamp', input: {} }] },
          ).model,
          { tools: { chooseLamp } },
        ),
      },
    });

    await executeTool(routeTool, { userQuery: 'Turn on a lamp.', async: false });
    const asked = await pollUntilClosed();
    expect(asked[asked.length - 1].questionsForUser).toEqual([{ id: 'lamp', question: QUESTION }]);

    await executeTool(routeTool, { userQuery: CHOICE, async: false });
    const answered = await pollUntilClosed();

    expect(answered.flatMap((response) => response.affectedEntities ?? [])).toEqual([
      { id: 'light.sofa_lamp', name: 'Sofa lamp' },
    ]);
    expect(answered[answered.length - 1].completedTaskResults).toEqual([
      { id: 'lamp', result: 'Turned on the sofa lamp.' },
    ]);
  }, 60_000);
});
