/**
 * A light switched by voice, from Jarvis's side of the line, with sir's headset watching.
 *
 * This is the path the ElevenLabs agent takes, through the same two MCP tools it calls:
 * `routePromptWorkflow` with what sir said, then `getNextInstructionsWorkflow` until a response
 * closes the request. In between, the planner hands the request to the Internet of Things agent,
 * which looks the lights up and then switches them off -- and the headset is to light up each thing
 * while that is happening, which means routing has to push it to the devices (`utils/live-events.ts`)
 * from the tool results the agent streams, long before the agent answers.
 *
 * That join is Mastra's undocumented chunk shape -- an agent step forwarding its agent's
 * `tool-result` chunks into the plan run as `workflow-step-output` -- and the controller spec only
 * feeds it chunks built by hand. A mismatch would be silent: the request would run and answer, and
 * nothing would ever glow. So it is pinned here against a real plan run, with scripted models and
 * Home Assistant faked at `fetch`.
 *
 * Last, a request the routing classifier answers without any agent (`direct-answers.ts`), which
 * streams no tool result at all, so routing has to be told what it touched some other way.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { Mastra } from '@mastra/core';
import { Classifier } from '@mastra/core/classifier';
import { InMemoryStore } from '@mastra/core/storage';
import { z } from 'zod';
import { createScriptedModel } from '../../../tests/utils/scripted-model.js';
import { type AffectedEntity, markAsAffectingEntities } from '../../utils/affected-entities.js';
import { createAgent } from '../../utils/agent-factory.js';
import { onLiveEvent } from '../../utils/live-events.js';
import { createInstructionsWorkflowTool, createSimplifiedWorkflowTool } from '../../utils/mcp-tool-factory.js';
import { createTool, executeTool } from '../../utils/tool-factory.js';
import { resetHomeDomainsForTest, resetHomeServicesForTest } from '../internet-of-things/home-commands.js';
import { callIoTService, findEntities, resetHomeAssistantCachesForTest } from '../internet-of-things/tools.js';
import { getAllTasks } from '../todo-list/tools.js';
import { forgetPhotos } from '../vision/photos.js';
import { setRoutingClassifierForTest } from './classifier.js';
import { type RoutingEvent, RoutingProgress, resetRoutingRuntime } from './controller.js';
import { PLANNER_AGENT_ID } from './planner.js';
import {
  getNextInstructionsWorkflow,
  instructionsOutputSchema,
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

const saved = new Map<string, string | undefined>();
let restoreFetch: (() => void) | undefined;

/** Every thing routing pushed to the devices during the test, in order. */
let pushed: AffectedEntity[] = [];
let stopListening: (() => void) | undefined;

beforeEach(() => {
  pushed = [];
  stopListening = onLiveEvent((event) => pushed.push(...event.entities));
});

afterEach(() => {
  stopListening?.();
  stopListening = undefined;
});

/** Resolves once `count` things have been pushed, or fails after a few seconds. */
async function untilPushed(count: number): Promise<void> {
  for (let attempt = 0; attempt < 200 && pushed.length < count; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(pushed.length).toBeGreaterThanOrEqual(count);
}

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
  it('pushes what the agent has looked up while it is still working, then what it switched', async () => {
    const house = fakeHomeAssistant();
    restoreFetch = () => house.fetchSpy.mockRestore();

    await executeTool(routeTool, { userQuery: REQUEST, async: false });

    // Pushed from the lookup's result, with the service call still held: long before any answer.
    await untilPushed(2);
    expect(pushed).toEqual([
      { id: 'light.kitchen_ceiling', name: 'Kitchen ceiling' },
      { id: 'light.kitchen_spots', name: 'Kitchen spots' },
    ]);

    house.letServiceCallThrough();
    const responses = await pollUntilClosed();
    const closing = responses[responses.length - 1];

    expect(closing.instructions).toContain('All tasks have completed');
    expect(closing.completedTaskResults).toEqual([{ id: 'lights', result: ANSWER }]);
    // The service call reached one light the lookup had not, and only that one is new.
    expect(pushed).toEqual([
      { id: 'light.kitchen_ceiling', name: 'Kitchen ceiling' },
      { id: 'light.kitchen_spots', name: 'Kitchen spots' },
      { id: 'light.pantry', name: 'Pantry' },
    ]);
    // None of it reaches the voice agent.
    for (const response of responses) {
      expect(Object.keys(response)).not.toContain('affectedEntities');
    }
  }, 60_000);

  it('answers a quick command in one response, having pushed everything it touched', async () => {
    const house = fakeHomeAssistant();
    restoreFetch = () => house.fetchSpy.mockRestore();
    house.letServiceCallThrough();

    await executeTool(routeTool, { userQuery: REQUEST, async: false });

    let first = await poll();
    for (let attempt = 0; attempt < 10 && first.instructions.startsWith('Still processing'); attempt += 1) {
      first = await poll();
    }

    expect(first.completedTaskResults).toEqual([{ id: 'lights', result: ANSWER }]);
    expect(pushed).toEqual([
      { id: 'light.kitchen_ceiling', name: 'Kitchen ceiling' },
      { id: 'light.kitchen_spots', name: 'Kitchen spots' },
      { id: 'light.pantry', name: 'Pantry' },
    ]);
  }, 60_000);
});

/**
 * An answer to a question is not part of any plan run: it resumes the agent that asked, and routing
 * reads that agent's own stream instead (see `resumeWithAnswer`). What the resumed tool touches has
 * to be pushed from there too.
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

  it('is pushed from the resumed agent’s own stream', async () => {
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

    expect(pushed).toEqual([{ id: 'light.sofa_lamp', name: 'Sofa lamp' }]);
    expect(answered[answered.length - 1].completedTaskResults).toEqual([
      { id: 'lamp', result: 'Turned on the sofa lamp.' },
    ]);
  }, 60_000);
});

/**
 * A request the routing classifier answers without its agent: no agent runs, so no tool result is
 * streamed for routing to read what was touched off, and the direct answer has to say so itself --
 * before its answer, as a tool's result comes before the agent's answer. One that fails or declines
 * goes to the agent instead, and says nothing of what it tried.
 */
describe('a request answered without its agent, with the headset watching', () => {
  const TO_DO_QUESTION = 'What is on my to-do list?';
  const LIGHTS_COMMAND = 'Turn off the lights.';
  const DEFAULT_TASK_LIST = { id: 'MTIzNDU2Nzg5', name: 'My Tasks' };
  const MILK = { id: 'task-1', title: 'Buy milk', status: 'needsAction', selfLink: 'https://tasks.test/task-1' };
  const TO_DO_ANSWER = 'There is one thing on your to-do list: buy milk.';
  const LIGHTS_ANSWER = 'Turned off the lights.';

  /** Home Assistant's one service, which a command can be carried out with directly. */
  const HOME_SERVICES = [
    {
      domain: 'light',
      services: {
        turn_off: { name: 'Turn off', description: 'Turns off lights.', target: { entity: [{ domain: ['light'] }] } },
      },
    },
  ];

  const spies: { mockRestore: () => void }[] = [];
  let handleSpy: ReturnType<typeof spyOn<RoutingProgress, 'handle'>> | undefined;

  /** Every event routing folded into the request, in order. */
  function eventsHandled(): RoutingEvent[] {
    return (handleSpy?.mock.calls ?? []).map(([event]) => event);
  }

  /** The events of the delegation a direct answer is reported as. */
  function directAnswerEvents(): RoutingEvent[] {
    return eventsHandled().filter((event) => 'delegationId' in event && event.delegationId.startsWith('direct-'));
  }

  /**
   * A routing classifier all but certain of each choice in `sureOf`, of none for any other choice,
   * and of no to every yes/no -- so it routes the request whole, as `sureOf` says, on its own.
   */
  function routingClassifierSureOf(sureOf: Record<string, string>): Classifier {
    return new Classifier({
      id: 'routingClassifier',
      model: {
        specificationVersion: 'v4',
        provider: 'fake',
        modelId: 'jev-fake',
        supportedQuestionTypes: ['choice', 'boolean'],
        doEvaluate: async ({ questions }) => ({
          answers: Object.fromEntries(
            Object.entries(questions).map(([questionId, question]) => {
              if (question.type !== 'choice') {
                return [questionId, { type: 'boolean' as const, probability: 0 }];
              }
              const choices = Object.keys(question.criteria);
              const wanted = sureOf[questionId] ?? 'none';
              const choice = choices.includes(wanted) ? wanted : (choices[0] ?? '');
              const others = choices.length - 1;
              const probabilities = Object.fromEntries(
                choices.map((option) => [option, option === choice ? 0.97 : 0.03 / Math.max(others, 1)]),
              );
              return [questionId, { type: 'choice' as const, choice, probabilities }];
            }),
          ),
          warnings: [],
        }),
      },
    });
  }

  beforeEach(async () => {
    resetRoutingRuntime();
    forgetPhotos();
    resetHomeAssistantCachesForTest();
    resetHomeServicesForTest();
    resetHomeDomainsForTest();

    // A house with one service to offer and no entities: a command can be routed to the direct
    // path, and the direct path then finds nothing to carry it out on.
    spies.push(
      spyOn(globalThis, 'fetch').mockImplementation(
        Object.assign(
          async (input: Parameters<typeof fetch>[0]) =>
            new Response(JSON.stringify(String(input).endsWith('/api/services') ? HOME_SERVICES : [])),
          { preconnect: globalThis.fetch.preconnect },
        ),
      ),
    );
    handleSpy = spyOn(RoutingProgress.prototype, 'handle');
    spies.push(handleSpy);

    new Mastra({
      storage: new InMemoryStore(),
      logger: false,
      workflows: { routePromptWorkflow, getNextInstructionsWorkflow },
      agents: {
        // The classifier settles every request here, so a planner that fails makes sure it does.
        [PLANNER_AGENT_ID]: await scriptedAgent(
          PLANNER_AGENT_ID,
          createScriptedModel(() => {
            throw new Error('The routing classifier settles these requests on its own.');
          }).model,
        ),
        todoList: await scriptedAgent('todoList', createScriptedModel(() => ({ text: TO_DO_ANSWER })).model),
        internetOfThings: await scriptedAgent(
          'internetOfThings',
          createScriptedModel(() => ({ text: LIGHTS_ANSWER })).model,
        ),
      },
    });
  });

  afterEach(() => {
    for (const spy of spies.splice(0)) {
      spy.mockRestore();
    }
    handleSpy = undefined;
    setRoutingClassifierForTest(undefined);
    resetHomeAssistantCachesForTest();
    resetHomeServicesForTest();
    resetHomeDomainsForTest();
  });

  it('pushes what a lookup read, before its answer', async () => {
    setRoutingClassifierForTest(
      routingClassifierSureOf({ route: 'todoList', responseStyle: 'lookup', directLookup: 'todoList.open' }),
    );
    spies.push(spyOn(getAllTasks, 'execute').mockResolvedValue({ tasks: [MILK], taskList: DEFAULT_TASK_LIST }));

    await executeTool(routeTool, { userQuery: TO_DO_QUESTION, async: false });
    const [first] = await pollUntilClosed();

    // The list itself, by its real id -- exactly what the agent's `getAllTasks` call reports.
    expect(pushed).toEqual([DEFAULT_TASK_LIST]);
    expect(first?.completedTaskResults).toEqual([{ id: 'todoList', result: '{"tasks":[{"title":"Buy milk"}]}' }]);
    expect(directAnswerEvents().map((event) => event.type)).toEqual([
      'delegation_start',
      'delegation_affected_entities',
      'delegation_end',
    ]);
  }, 60_000);

  it('hands a lookup that fails to the agent, and reports nothing of what it tried', async () => {
    setRoutingClassifierForTest(
      routingClassifierSureOf({ route: 'todoList', responseStyle: 'lookup', directLookup: 'todoList.open' }),
    );
    spies.push(spyOn(getAllTasks, 'execute').mockRejectedValue(new Error('Google Tasks is down')));

    await executeTool(routeTool, { userQuery: TO_DO_QUESTION, async: false });
    const responses = await pollUntilClosed();

    expect(responses[responses.length - 1]?.completedTaskResults).toEqual([{ id: 'todoList', result: TO_DO_ANSWER }]);
    expect(pushed).toEqual([]);
    expect(directAnswerEvents()).toEqual([]);
    expect(eventsHandled().filter((event) => event.type === 'delegation_affected_entities')).toEqual([]);
  }, 60_000);

  it('hands a command the direct path declines to the agent, and reports nothing of what it tried', async () => {
    setRoutingClassifierForTest(
      routingClassifierSureOf({ route: 'internetOfThings', responseStyle: 'command', homeService: 'light.turn_off' }),
    );

    await executeTool(routeTool, { userQuery: LIGHTS_COMMAND, async: false });
    const responses = await pollUntilClosed();

    expect(responses[responses.length - 1]?.completedTaskResults).toEqual([
      { id: 'internetOfThings', result: LIGHTS_ANSWER },
    ]);
    expect(pushed).toEqual([]);
    expect(directAnswerEvents()).toEqual([]);
    expect(eventsHandled().filter((event) => event.type === 'delegation_affected_entities')).toEqual([]);
  }, 60_000);
});
