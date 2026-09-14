import { afterEach, beforeEach, describe, expect, it, type Mock, mock } from 'bun:test';
import type { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import {
  type AgentProvider,
  dagSchema,
  getCurrentDAG,
  getCurrentDagWorkflow,
  getNextInstructionsWorkflow,
  resetRoutingOverrides,
  routePromptWorkflow,
  setAgentProvider,
  setTaskPlanner,
  type TaskPlanner,
} from './workflows.js';

interface MockAgentOptions {
  description?: string;
  tools?: string[];
  respond?: (prompt: string) => string | Promise<string>;
}

interface MockAgent {
  id: string;
  name: string;
  getDescription(): string;
  listTools(): Promise<Record<string, unknown>>;
  generate: Mock<(messages: unknown) => Promise<{ text: string }>>;
  prompts: string[];
}

function createMockAgent(id: string, options: MockAgentOptions = {}): MockAgent {
  const prompts: string[] = [];

  const generate = mock(async (messages: unknown) => {
    const prompt = Array.isArray(messages) ? String((messages[0] as { content?: unknown })?.content ?? '') : '';
    prompts.push(prompt);
    const respond = options.respond ?? (() => `Mock response from ${id}`);
    return { text: await respond(prompt) };
  });

  return {
    id,
    name: id,
    getDescription: () => options.description ?? `Mock agent ${id}`,
    listTools: async () => Object.fromEntries((options.tools ?? []).map((tool) => [tool, {}])),
    generate,
    prompts,
  };
}

interface GatedAgent {
  agent: MockAgent;
  finish: () => void;
}

/** An agent that hangs until the test releases it. */
function createGatedAgent(id: string, answer: string): GatedAgent {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    agent: createMockAgent(id, {
      respond: async () => {
        await gate;
        return answer;
      },
    }),
    finish: release,
  };
}

function useAgents(...agents: MockAgent[]): void {
  const provider: AgentProvider = async () => agents as unknown as Agent[];
  setAgentProvider(provider);
}

type PlannedTask = { id: string; agent: string; prompt: string; dependsOn: string[] };

function usePlan(...tasks: PlannedTask[]): void {
  const planner: TaskPlanner = async () => ({ tasks });
  setTaskPlanner(planner);
}

async function runWorkflow<TInput, TResult>(
  workflow: { createRun(): Promise<{ start: (args: { inputData: TInput }) => Promise<TResult> }> },
  inputData: TInput,
): Promise<TResult> {
  const run = await workflow.createRun();
  return run.start({ inputData });
}

const routeResultSchema = z.object({
  instructions: z.string(),
  taskIdsInProgress: z.array(z.string()),
});

const instructionsResultSchema = z.object({
  instructions: z.string(),
  completedTaskResults: z.array(z.object({ id: z.string(), result: z.unknown() })).optional(),
  taskIdsInProgress: z.array(z.string()).optional(),
});

function assertSuccess<T>(result: { status: string; result?: unknown }, schema: z.ZodType<T>): T {
  expect(result.status).toBe('success');
  return schema.parse(result.result);
}

async function route(userQuery: string, isAsync = false) {
  const result = await runWorkflow(routePromptWorkflow, { userQuery, async: isAsync });
  return assertSuccess(result, routeResultSchema);
}

async function nextInstructions() {
  const result = await runWorkflow(getNextInstructionsWorkflow, {});
  return assertSuccess(result, instructionsResultSchema);
}

/** Polls until the DAG reports everything finished, collecting each report. */
async function pollUntilComplete(maxPolls = 10) {
  const reports: z.infer<typeof instructionsResultSchema>[] = [];
  for (let i = 0; i < maxPolls; i++) {
    const report = await nextInstructions();
    reports.push(report);
    if (report.instructions.startsWith('All tasks have completed')) {
      return reports;
    }
  }
  throw new Error(`DAG did not complete within ${maxPolls} polls: ${JSON.stringify(reports, null, 2)}`);
}

describe('Routing Workflows', () => {
  beforeEach(() => {
    resetRoutingOverrides();
  });

  afterEach(() => {
    resetRoutingOverrides();
  });

  describe('routePromptWorkflow', () => {
    it('plans the DAG and hands the pending task IDs back to the caller', async () => {
      useAgents(createMockAgent('weather'), createMockAgent('calendar'));
      usePlan(
        { id: 'weather-check', agent: 'weather', prompt: 'Get the weather', dependsOn: [] },
        { id: 'calendar-check', agent: 'calendar', prompt: 'Get the calendar', dependsOn: [] },
      );

      const result = await route('What is the weather and what is on my calendar?');

      expect(result.instructions).toContain('getNextInstructionsWorkflow');
      expect(result.taskIdsInProgress).toEqual(['weather-check', 'calendar-check']);
    });

    it('asks Jarvis to speak before polling, so the user is not left in silence', async () => {
      useAgents(createMockAgent('calendar'));
      usePlan({ id: 'calendar-check', agent: 'calendar', prompt: 'Get the calendar', dependsOn: [] });

      const result = await route('Check my calendar for today');

      // Queueing hides the longest wait in the loop — the DAG is planned and its
      // first wave runs behind it. Without this, Jarvis routed and then polled
      // without a word, and the user heard nothing at all until the final answer.
      expect(result.instructions).toContain('silence');
      // Said here and nowhere else. The agent prompt used to ask for the same line,
      // and Jarvis obligingly delivered it twice.
      expect(result.instructions).toContain('nowhere else');
      // The polling half of the contract has to survive the addition.
      expect(result.instructions).toContain('getNextInstructionsWorkflow');
    });

    it('carries the loop and its failure handling, so the prompt does not have to', async () => {
      useAgents(createMockAgent('calendar'));
      usePlan({ id: 'calendar-check', agent: 'calendar', prompt: 'Get the calendar', dependsOn: [] });

      const result = await route('Check my calendar for today');

      // The agent prompt used to spell all of this out, on every turn, whether or
      // not a request was in flight. It says only "do what the instructions say" now,
      // so the first instruction it ever sees has to describe the whole loop: keep
      // calling until told otherwise, and retry a call that fails instead of
      // treating the error as an answer.
      expect(result.instructions).toContain('keep doing exactly what each response tells you');
      expect(result.instructions).toContain('every task has completed');
      expect(result.instructions).toContain('call it again');
      expect(result.instructions).toContain('never the end of the request');
    });

    it('does not run any task before the caller asks for instructions', async () => {
      const weather = createMockAgent('weather');
      useAgents(weather);
      usePlan({ id: 'weather-check', agent: 'weather', prompt: 'Get the weather', dependsOn: [] });

      await route('What is the weather?');

      expect(weather.generate).not.toHaveBeenCalled();
    });

    it('tells Jarvis to end the call and drives the DAG itself when async', async () => {
      const weather = createMockAgent('weather');
      useAgents(weather);
      usePlan({ id: 'weather-check', agent: 'weather', prompt: 'Get the weather', dependsOn: [] });

      const result = await route('What is the weather?', true);

      expect(result.instructions).toContain('End the call');
      expect(result.instructions).not.toContain('getNextInstructionsWorkflow');

      // The fire-and-forget driver keeps resuming without anyone polling.
      await waitFor(() => getCurrentDAG().tasks.every((task) => task.status === 'completed'));
      expect(weather.generate).toHaveBeenCalledTimes(1);
    });

    it('drops tasks assigned to agents that do not exist', async () => {
      useAgents(createMockAgent('weather'));
      usePlan(
        { id: 'weather-check', agent: 'weather', prompt: 'Get the weather', dependsOn: [] },
        { id: 'bogus', agent: 'teleporter', prompt: 'Teleport me', dependsOn: [] },
      );

      const result = await route('What is the weather?');

      expect(result.taskIdsInProgress).toEqual(['weather-check']);
    });

    it('breaks cyclic dependencies rather than deadlocking', async () => {
      const weather = createMockAgent('weather');
      useAgents(weather);
      usePlan(
        { id: 'a', agent: 'weather', prompt: 'A', dependsOn: ['b'] },
        { id: 'b', agent: 'weather', prompt: 'B', dependsOn: ['a'] },
      );

      await route('Do the impossible');
      await pollUntilComplete();

      expect(getCurrentDAG().tasks.every((task) => task.status === 'completed')).toBe(true);
    });

    it('ignores dependencies on tasks that were never planned', async () => {
      useAgents(createMockAgent('weather'));
      usePlan({ id: 'weather-check', agent: 'weather', prompt: 'Get the weather', dependsOn: ['ghost-task'] });

      await route('What is the weather?');
      const reports = await pollUntilComplete();

      const lastReport = reports[reports.length - 1];
      expect(lastReport.completedTaskResults?.[0].id).toBe('weather-check');
    });
  });

  describe('getNextInstructionsWorkflow', () => {
    it('runs the ready tasks and reports their results', async () => {
      useAgents(createMockAgent('weather', { respond: () => 'Sunny, 22°C' }));
      usePlan({ id: 'weather-check', agent: 'weather', prompt: 'Get the weather', dependsOn: [] });

      await route('What is the weather?');
      const report = await nextInstructions();

      expect(report.instructions).toContain('All tasks have completed');
      expect(report.completedTaskResults).toHaveLength(1);
      expect(report.completedTaskResults?.[0]).toEqual({ id: 'weather-check', result: 'Sunny, 22°C' });
      expect(report.taskIdsInProgress).toEqual([]);
    });

    it('withholds intermediate results and asks for a brief acknowledgement', async () => {
      useAgents(
        createMockAgent('weather', { respond: () => 'Aarhus, Denmark' }),
        createMockAgent('calendar', { respond: () => 'Standup at 9am' }),
      );
      usePlan(
        { id: 'get-location', agent: 'weather', prompt: 'Where am I?', dependsOn: [] },
        { id: 'get-weather', agent: 'calendar', prompt: 'Weather there?', dependsOn: ['get-location'] },
      );

      await route('What is the weather where I am?');

      const first = await nextInstructions();
      expect(first.instructions).toContain('not all tasks have completed');
      expect(first.instructions).toContain('less than 5 words');
      // Each further poll is a machine action like the first one, and the user has
      // no use for hearing that it happened.
      expect(first.instructions).toContain('without announcing that you are checking');
      expect(first.completedTaskResults).toEqual([{ id: 'get-location', result: undefined }]);
      expect(first.taskIdsInProgress).toEqual(['get-weather']);

      // The closing report recaps everything, including the intermediate result
      // withheld above: it is the last chance to say anything, so it carries the
      // lot rather than only what finished last.
      const second = await nextInstructions();
      expect(second.instructions).toContain('All tasks have completed');
      expect(second.completedTaskResults).toEqual([
        { id: 'get-location', result: 'Aarhus, Denmark' },
        { id: 'get-weather', result: 'Standup at 9am' },
      ]);
    });

    it('points a finished request back at routing for whatever the user asks next', async () => {
      useAgents(createMockAgent('calendar', { respond: () => 'A birthday' }));
      usePlan({ id: 'calendar-check', agent: 'calendar', prompt: 'Get the calendar', dependsOn: [] });

      await route('Check my calendar');
      const report = await nextInstructions();

      expect(report.instructions).toContain('All tasks have completed');
      // Finishing one request is not finishing the conversation. Asked next to check
      // the blinds and lights, Jarvis promised to look and called nothing — the last
      // instruction of the loop had left it with no pointer back to the tool.
      expect(report.instructions).toContain('routePromptWorkflow');
      expect(report.instructions).toContain('not the conversation');
    });

    it('reports a finished task without waiting for the slow one beside it', async () => {
      // Both tasks are independent, so they share a wave. The wave itself is a
      // barrier, and results used to be withheld until every task in it had
      // returned: measured on this exact shape, a result ready at 100ms reached
      // the user at 20s, held up purely by the task next to it.
      const calendar = createGatedAgent('calendar', 'A birthday');
      useAgents(createMockAgent('weather', { respond: () => 'Sunny, 22°C' }), calendar.agent);
      usePlan(
        { id: 'weather-check', agent: 'weather', prompt: 'Weather?', dependsOn: [] },
        { id: 'calendar-check', agent: 'calendar', prompt: 'Calendar?', dependsOn: [] },
      );

      await route('What is the weather and what is on my calendar?');

      // The calendar agent has not been released, so this can only be the
      // weather result arriving on its own.
      const first = await nextInstructions();
      expect(first.completedTaskResults).toEqual([{ id: 'weather-check', result: 'Sunny, 22°C' }]);
      expect(first.taskIdsInProgress).toEqual(['calendar-check']);
      expect(first.instructions).toContain('not all tasks have completed');
      expect(first.instructions).toContain('getNextInstructionsWorkflow');

      calendar.finish();

      const second = await nextInstructions();
      expect(second.instructions).toContain('All tasks have completed');
      expect(second.completedTaskResults).toEqual([
        { id: 'weather-check', result: 'Sunny, 22°C' },
        { id: 'calendar-check', result: 'A birthday' },
      ]);
      expect(second.taskIdsInProgress).toEqual([]);
    });

    it('walks a dependent chain one task at a time, carrying the context forward', async () => {
      // "Check the calendar for the week, then send me an email summarising it."
      // The email cannot start until the calendar has answered, and it needs
      // that answer in hand when it does.
      const calendar = createMockAgent('calendar', {
        respond: () => 'Mon: standup at 9. Wed: design review at 14.',
      });
      const email = createMockAgent('email', { respond: () => 'Summary sent to you, sir.' });
      useAgents(calendar, email);
      usePlan(
        { id: 'calendar-week', agent: 'calendar', prompt: "This week's calendar?", dependsOn: [] },
        { id: 'send-email', agent: 'email', prompt: 'Email a summary of it', dependsOn: ['calendar-week'] },
      );

      await route('Check my calendar for the week, then email me a summary');

      // The calendar is plumbing for the email, not an answer in its own right,
      // so its result is withheld and only its progress is relayed.
      const first = await nextInstructions();
      expect(first.completedTaskResults).toEqual([{ id: 'calendar-week', result: undefined }]);
      expect(first.taskIdsInProgress).toEqual(['send-email']);
      expect(first.instructions).toContain('less than 5 words');

      const second = await nextInstructions();
      expect(second.instructions).toContain('All tasks have completed');
      expect(second.completedTaskResults).toEqual([
        { id: 'calendar-week', result: 'Mon: standup at 9. Wed: design review at 14.' },
        { id: 'send-email', result: 'Summary sent to you, sir.' },
      ]);
      expect(second.taskIdsInProgress).toEqual([]);

      // The whole point of the dependency: the email agent was handed what the
      // calendar found, not merely told to go and summarise something.
      expect(email.prompts).toHaveLength(1);
      expect(email.prompts[0]).toContain('Email a summary of it');
      expect(email.prompts[0]).toContain('Mon: standup at 9. Wed: design review at 14.');
    });

    it('never relays the same task twice while the request is still running', async () => {
      useAgents(createMockAgent('weather'), createMockAgent('calendar'));
      usePlan(
        { id: 'root', agent: 'weather', prompt: 'Root', dependsOn: [] },
        { id: 'leaf-a', agent: 'calendar', prompt: 'Leaf A', dependsOn: ['root'] },
        { id: 'leaf-b', agent: 'calendar', prompt: 'Leaf B', dependsOn: ['root'] },
      );

      await route('Do three things');
      const reports = await pollUntilComplete();

      // Mid-flight reports carry only what is new — hearing a result twice while
      // waiting is noise. The closing report is the exception and is checked below.
      const inFlight = reports.slice(0, -1);
      const relayedIds = inFlight.flatMap((report) => report.completedTaskResults?.map((task) => task.id) ?? []);
      expect(relayedIds).toEqual([...new Set(relayedIds)]);
      expect(relayedIds).toEqual(['root', 'leaf-a', 'leaf-b'].slice(0, relayedIds.length));
    });

    // The failure this exists for: an end-to-end run had two polls fail at the
    // ElevenLabs boundary, and because a result is marked reported when its report
    // is *built*, the calendar and the recipe those responses carried were never
    // mentioned again. The loop still closed with "All tasks have completed" — true
    // of the DAG, false of what the user had been told.
    it('recaps every result at the close, so nothing is lost with a dropped response', async () => {
      useAgents(createMockAgent('weather'), createMockAgent('calendar'));
      usePlan(
        { id: 'root', agent: 'weather', prompt: 'Root', dependsOn: [] },
        { id: 'leaf-a', agent: 'calendar', prompt: 'Leaf A', dependsOn: ['root'] },
        { id: 'leaf-b', agent: 'calendar', prompt: 'Leaf B', dependsOn: ['root'] },
      );

      await route('Do three things');
      const reports = await pollUntilComplete();
      const closing = reports[reports.length - 1];

      expect(closing.instructions).toContain('All tasks have completed');
      expect(closing.completedTaskResults?.map((task) => task.id)).toEqual(['root', 'leaf-a', 'leaf-b']);
      // Every one carries its result, including the intermediate whose result was
      // withheld on the way through — a recap that omitted it would still lose it.
      expect(closing.completedTaskResults?.every((task) => task.result !== undefined)).toBe(true);
      // And it says so, so Jarvis recaps briefly rather than reading everything twice.
      expect(closing.instructions).toContain('already relayed');
    });

    it('feeds a task the results of the tasks it depends on', async () => {
      const weather = createMockAgent('weather', { respond: () => 'Aarhus, Denmark' });
      const commute = createMockAgent('commute');
      useAgents(weather, commute);
      usePlan(
        { id: 'get-location', agent: 'weather', prompt: 'Where am I?', dependsOn: [] },
        { id: 'get-commute', agent: 'commute', prompt: 'How long to work?', dependsOn: ['get-location'] },
      );

      await route('How long is my commute?');
      await pollUntilComplete();

      expect(commute.prompts[0]).toContain('How long to work?');
      expect(commute.prompts[0]).toContain('Aarhus, Denmark');
    });

    it('runs independent tasks in the same wave', async () => {
      useAgents(createMockAgent('weather'), createMockAgent('calendar'));
      usePlan(
        { id: 'weather-check', agent: 'weather', prompt: 'Weather', dependsOn: [] },
        { id: 'calendar-check', agent: 'calendar', prompt: 'Calendar', dependsOn: [] },
      );

      await route('Weather and calendar');
      const report = await nextInstructions();

      expect(report.instructions).toContain('All tasks have completed');
      expect(report.completedTaskResults?.map((task) => task.id)).toEqual(['weather-check', 'calendar-check']);
    });

    it('keeps going when an agent throws', async () => {
      const weather = createMockAgent('weather', {
        respond: () => {
          throw new Error('upstream exploded');
        },
      });
      const calendar = createMockAgent('calendar', { respond: () => 'Standup at 9am' });
      useAgents(weather, calendar);
      usePlan(
        { id: 'weather-check', agent: 'weather', prompt: 'Weather', dependsOn: [] },
        { id: 'calendar-check', agent: 'calendar', prompt: 'Calendar', dependsOn: [] },
      );

      await route('Weather and calendar');
      const report = await nextInstructions();

      expect(report.instructions).toContain('All tasks have completed');
      const weatherResult = report.completedTaskResults?.find((task) => task.id === 'weather-check');
      expect(String(weatherResult?.result)).toContain('upstream exploded');
      expect(getCurrentDAG().tasks.find((task) => task.id === 'weather-check')?.status).toBe('failed');
    });

    it('tells the caller to try again when there is nothing being routed', async () => {
      const report = await nextInstructions();
      expect(report.instructions).toContain('Still processing');
      // A poll with nothing to report is not a cue to speak. The "I'm on it" line
      // was already given when the request was queued, and the prompt no longer
      // carries a rule about staying quiet through the wait, so this one does.
      expect(report.instructions).toContain('Say nothing to the user in the meantime');
    });

    it('repeats the final report instead of resuming a finished run', async () => {
      useAgents(createMockAgent('weather'));
      usePlan({ id: 'weather-check', agent: 'weather', prompt: 'Weather', dependsOn: [] });

      await route('What is the weather?');
      const first = await nextInstructions();
      const second = await nextInstructions();

      expect(second).toEqual(first);
    });
  });

  describe('getCurrentDagWorkflow', () => {
    it('exposes the planned graph and its execution status', async () => {
      useAgents(createMockAgent('weather'), createMockAgent('calendar'));
      usePlan(
        { id: 'get-location', agent: 'weather', prompt: 'Where am I?', dependsOn: [] },
        { id: 'get-weather', agent: 'calendar', prompt: 'Weather there?', dependsOn: ['get-location'] },
      );

      await route('What is the weather where I am?');

      const pending = assertSuccess(await runWorkflow(getCurrentDagWorkflow, {}), dagSchema);
      expect(pending.userQuery).toBe('What is the weather where I am?');
      expect(pending.tasks.map((task) => [task.id, task.status])).toEqual([
        ['get-location', 'pending'],
        ['get-weather', 'pending'],
      ]);

      await pollUntilComplete();

      const done = assertSuccess(await runWorkflow(getCurrentDagWorkflow, {}), dagSchema);
      expect(done.tasks.every((task) => task.status === 'completed')).toBe(true);
    });

    it('is empty before anything has been routed', async () => {
      const dag = assertSuccess(await runWorkflow(getCurrentDagWorkflow, {}), dagSchema);
      expect(dag.tasks).toEqual([]);
    });
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
