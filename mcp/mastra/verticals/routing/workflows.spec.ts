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
      expect(first.completedTaskResults).toEqual([{ id: 'get-location', result: undefined }]);
      expect(first.taskIdsInProgress).toEqual(['get-weather']);

      const second = await nextInstructions();
      expect(second.instructions).toContain('All tasks have completed');
      expect(second.completedTaskResults).toEqual([{ id: 'get-weather', result: 'Standup at 9am' }]);
    });

    it('never reports the same task twice', async () => {
      useAgents(createMockAgent('weather'), createMockAgent('calendar'));
      usePlan(
        { id: 'root', agent: 'weather', prompt: 'Root', dependsOn: [] },
        { id: 'leaf-a', agent: 'calendar', prompt: 'Leaf A', dependsOn: ['root'] },
        { id: 'leaf-b', agent: 'calendar', prompt: 'Leaf B', dependsOn: ['root'] },
      );

      await route('Do three things');
      const reports = await pollUntilComplete();

      const reportedIds = reports.flatMap((report) => report.completedTaskResults?.map((task) => task.id) ?? []);
      expect(reportedIds).toEqual(['root', 'leaf-a', 'leaf-b']);
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
