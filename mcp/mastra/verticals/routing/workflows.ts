import type { Agent } from '@mastra/core/agent';
import z from 'zod';
import { createStep, createWorkflow, getWorkflowRuntime } from '../../utils';
import { getPublicAgents } from '..';
import { getRoutingPlannerAgent } from './agents.js';

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */
/*
 * These schemas are what the MCP server (and therefore the ElevenLabs Jarvis
 * agent) sees. They are deliberately unchanged: a routing request is still a
 * DAG of tasks, and the caller still polls for instructions until everything
 * has finished.
 *
 * What changed is the machinery underneath. Instead of a hand-rolled promise
 * registry with completion listeners and timers, the DAG is now a real Mastra
 * workflow: a planner agent emits the graph, the tasks are executed as workflow
 * steps that call the target agents, and the workflow suspends every time it
 * has something to report. `getNextInstructionsWorkflow` is just a resume.
 */

const outputTaskSchema = z.object({
  id: z.string().describe('The unique task ID for this task'),
  agent: z.string().describe('Agent ID to use for this task'),
  prompt: z.string().describe('Input to provide to the agent for this task'),
  dependsOn: z.array(z.string()).describe('IDs of tasks this task depends on'),
});

export const outputSchema = z
  .object({
    tasks: z.array(outputTaskSchema),
  })
  .describe('The generated DAG of tasks to fulfill the routing query');

export const inputSchema = z.object({
  userQuery: z
    .string()
    .describe("The user's routing query")
    .default(
      "I'd like to check the weather for my current location, and check my calendar for today. If I have any calendars regarding my workplace, I'd like to infer when I typically go to work, and check the traffic conditions for that time. Additionally, I am planning on making a lasagna, so please fetch the recipes for that and add a reminder to my to-do list with the ingredients, for when I get home from work.",
    ),
  async: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Whether to run the DAG asynchronously (fire-and-forget). If true, the instructions will tell Jarvis to end the call immediately.',
    ),
});

const taskStatusSchema = z.enum(['pending', 'running', 'completed', 'failed']);

const dagTaskSchema = outputTaskSchema.extend({
  status: taskStatusSchema.describe('Current execution status of the task'),
  result: z.unknown().optional().describe('Result of the task execution'),
  reported: z.boolean().describe('Whether the task result has been reported back to Jarvis'),
});

export const dagSchema = z.object({
  userQuery: z.string().describe('The user query the DAG was planned for'),
  tasks: z.array(dagTaskSchema),
});

export type Dag = z.infer<typeof dagSchema>;

const routeAcknowledgementSchema = z.object({
  instructions: z.string().describe('Instructions for Jarvis to follow'),
  taskIdsInProgress: z.array(z.string()).describe('IDs of tasks currently in progress'),
});

const instructionsOutputSchema = z.object({
  instructions: z.string().describe('Instructions for Jarvis to follow'),
  completedTaskResults: z
    .array(
      z.object({
        id: z.string().describe('The unique task ID'),
        result: z.unknown().describe('Result of the task execution'),
      }),
    )
    .optional()
    .describe('Results of completed tasks, if any'),
  taskIdsInProgress: z.array(z.string()).optional().describe('IDs of tasks still pending'),
});

/**
 * Instruction strings handed back to Jarvis. They are part of the outward
 * contract — `elevenlabs/src/assets/agent-prompt.md` documents this loop — so
 * treat them as API surface rather than log messages.
 */
const INSTRUCTIONS = {
  async: 'The request is being processed in the background and will complete on its own. End the call now.',
  poll: 'The request is now being processed in the background. Call getNextInstructionsWorkflow to check on the status and receive the next instructions.',
  stillProcessing:
    'Still processing your request. Call getNextInstructionsWorkflow again to wait a bit longer for it to complete.',
  summarize: 'Summarize the new completed task results in a detailed manner.',
  acknowledge: 'Mention briefly that you have received the information in less than 5 words.',
} as const;

const ALL_TASKS_COMPLETED_INSTRUCTIONS = `All tasks have completed. ${INSTRUCTIONS.summarize}`;

/** How long a single poll may block before we tell Jarvis to call again. */
const POLL_DEADLINE_MS = 15_000;

/** How many tasks of a single DAG wave may call their agent at the same time. */
const TASK_CONCURRENCY = 5;

/* -------------------------------------------------------------------------- */
/* Injectable collaborators                                                   */
/* -------------------------------------------------------------------------- */

export type AgentProvider = () => Promise<Agent[]>;

/** Turns a user query plus the routable agents into a task DAG. */
export type TaskPlanner = (userQuery: string, agents: Agent[]) => Promise<z.infer<typeof outputSchema>>;

let agentProvider: AgentProvider = getPublicAgents;
let taskPlanner: TaskPlanner | undefined;
let agentsById: Promise<Map<string, Agent>> | undefined;

/** Overrides the set of agents the router may route to. Used by tests. */
export function setAgentProvider(provider: AgentProvider): void {
  agentProvider = provider;
  agentsById = undefined;
}

/** Overrides DAG planning so tests can supply a deterministic graph. */
export function setTaskPlanner(planner: TaskPlanner): void {
  taskPlanner = planner;
}

/** Restores the real agent provider and planner, and forgets the active run. */
export function resetRoutingOverrides(): void {
  agentProvider = getPublicAgents;
  taskPlanner = undefined;
  agentsById = undefined;
  activeRouting = undefined;
}

async function getAgentsById(): Promise<Map<string, Agent>> {
  agentsById ??= agentProvider().then((agents) => new Map(agents.map((agent) => [agent.id, agent])));
  return agentsById;
}

/* -------------------------------------------------------------------------- */
/* Planning                                                                   */
/* -------------------------------------------------------------------------- */

async function describeAgent(agent: Agent): Promise<string> {
  const toolNames = await agent
    .listTools()
    .then((tools) => Object.keys(tools))
    .catch(() => [] as string[]);

  const description = agent.getDescription() || 'No description provided.';
  const tools = toolNames.length > 0 ? `\nTools: ${toolNames.join(', ')}` : '';
  return `## ${agent.id}\n${description}${tools}`;
}

async function planWithPlannerAgent(userQuery: string, agents: Agent[]): Promise<z.infer<typeof outputSchema>> {
  const catalog = (await Promise.all(agents.map(describeAgent))).join('\n\n');
  const planner = await getRoutingPlannerAgent();

  const response = await planner.generate(
    [
      {
        role: 'user',
        content: `Plan the task DAG for this user request.\n\n# User request\n${userQuery}\n\n# Available agents\n${catalog}`,
      },
    ],
    {
      structuredOutput: { schema: outputSchema },
      modelSettings: { temperature: 0 },
      toolChoice: 'none',
    },
  );

  if (response.object) {
    return outputSchema.parse(response.object);
  }

  const text = response.text?.trim();
  if (text?.startsWith('{')) {
    return outputSchema.parse(JSON.parse(text));
  }

  throw new Error('Routing planner did not return a task DAG');
}

/**
 * Drops anything the planner may have hallucinated: unknown agents, duplicate
 * IDs, dependencies on tasks that do not exist, self-references and cycles.
 * A malformed graph would otherwise deadlock the executor.
 */
function sanitizePlan(tasks: z.infer<typeof outputTaskSchema>[], knownAgentIds: Set<string>): Dag['tasks'] {
  const accepted = new Map<string, z.infer<typeof outputTaskSchema>>();

  for (const task of tasks) {
    if (!knownAgentIds.has(task.agent)) {
      console.warn(`Routing plan referenced unknown agent "${task.agent}"; dropping task "${task.id}".`);
      continue;
    }
    if (accepted.has(task.id)) {
      console.warn(`Routing plan contained duplicate task ID "${task.id}"; keeping the first one.`);
      continue;
    }
    accepted.set(task.id, task);
  }

  // Keep only dependencies that point at another accepted task, then drop any
  // edge that would close a cycle by walking the graph in topological order.
  const resolved = new Set<string>();
  const ordered: Dag['tasks'] = [];
  const remaining = new Map(
    [...accepted.values()].map((task) => [
      task.id,
      { ...task, dependsOn: task.dependsOn.filter((id) => id !== task.id && accepted.has(id)) },
    ]),
  );

  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((task) => task.dependsOn.every((id) => resolved.has(id)));
    const batch = ready.length > 0 ? ready : [...remaining.values()].slice(0, 1);

    for (const task of batch) {
      const dependsOn = task.dependsOn.filter((id) => resolved.has(id));
      if (dependsOn.length !== task.dependsOn.length) {
        console.warn(`Routing plan had a cyclic dependency on task "${task.id}"; dropping the offending edges.`);
      }
      ordered.push({ ...task, dependsOn, status: 'pending', reported: false });
      resolved.add(task.id);
      remaining.delete(task.id);
    }
  }

  return ordered;
}

/* -------------------------------------------------------------------------- */
/* DAG workflow                                                               */
/* -------------------------------------------------------------------------- */

const waveSignalSchema = z.object({
  isComplete: z.boolean().describe('Whether every task in the DAG has finished'),
});

const taskExecutionSchema = z.object({
  taskId: z.string(),
  agent: z.string(),
  prompt: z.string(),
});

const taskResultSchema = z.object({
  taskId: z.string(),
  result: z.string(),
  failed: z.boolean(),
});

const emptyDag = (): Dag => ({ userQuery: '', tasks: [] });

function isFinished(task: Dag['tasks'][number]): boolean {
  return task.status === 'completed' || task.status === 'failed';
}

function isLeaf(task: Dag['tasks'][number], tasks: Dag['tasks']): boolean {
  return !tasks.some((other) => other.dependsOn.includes(task.id));
}

/**
 * Builds the payload Jarvis receives for one poll, and marks the tasks it
 * covers as reported so the next poll only carries new information.
 *
 * Leaves carry the answers the user actually asked for; intermediate tasks are
 * plumbing. When a wave produced any leaf we hand over the results and ask for
 * a summary, otherwise we only acknowledge progress.
 */
function buildProgressReport(tasks: Dag['tasks']): z.infer<typeof instructionsOutputSchema> {
  const newlyFinished = tasks.filter((task) => isFinished(task) && !task.reported);
  const includesLeaf = newlyFinished.some((task) => isLeaf(task, tasks));
  const remaining = tasks.filter((task) => !isFinished(task));

  for (const task of newlyFinished) {
    task.reported = true;
  }

  const instructions =
    remaining.length === 0
      ? ALL_TASKS_COMPLETED_INSTRUCTIONS
      : `More tasks have finished since last time, but not all tasks have completed yet. ${
          includesLeaf ? INSTRUCTIONS.summarize : INSTRUCTIONS.acknowledge
        } Then call getNextInstructionsWorkflow again.`;

  return {
    instructions,
    completedTaskResults: newlyFinished.map((task) => ({
      id: task.id,
      result: includesLeaf ? task.result : undefined,
    })),
    taskIdsInProgress: remaining.map((task) => task.id),
  };
}

const planTasksStep = createStep({
  id: 'plan-tasks',
  description: 'Ask the routing planner agent for the DAG of tasks that fulfils the user query',
  inputSchema: z.object({ userQuery: z.string() }),
  outputSchema: outputSchema,
  stateSchema: dagSchema,
  execute: async ({ inputData, setState }) => {
    const agents = [...(await getAgentsById()).values()];
    const plan = await (taskPlanner ?? planWithPlannerAgent)(inputData.userQuery, agents);
    const tasks = sanitizePlan(plan.tasks, new Set(agents.map((agent) => agent.id)));

    console.log(`Planned ${tasks.length} task(s) for routing query.`);
    setState({ userQuery: inputData.userQuery, tasks });

    return { tasks: tasks.map(({ id, agent, prompt, dependsOn }) => ({ id, agent, prompt, dependsOn })) };
  },
});

const handOffStep = createStep({
  id: 'hand-off-to-caller',
  description: 'Suspend once the plan exists so the caller can start polling for instructions',
  inputSchema: outputSchema,
  outputSchema: waveSignalSchema,
  stateSchema: dagSchema,
  suspendSchema: routeAcknowledgementSchema,
  resumeSchema: z.object({ acknowledged: z.boolean().default(true) }),
  execute: async ({ resumeData, state, suspend }) => {
    if (!resumeData) {
      await suspend({
        instructions: INSTRUCTIONS.poll,
        taskIdsInProgress: state.tasks.filter((task) => !isFinished(task)).map((task) => task.id),
      });
    }

    return { isComplete: state.tasks.length === 0 };
  },
});

const selectReadyTasksStep = createStep({
  id: 'select-ready-tasks',
  description: 'Pick the tasks whose dependencies have all finished',
  inputSchema: waveSignalSchema,
  outputSchema: z.array(taskExecutionSchema),
  stateSchema: dagSchema,
  execute: async ({ state, setState }) => {
    const finishedIds = new Set(state.tasks.filter(isFinished).map((task) => task.id));
    const ready = state.tasks.filter(
      (task) => task.status === 'pending' && task.dependsOn.every((id) => finishedIds.has(id)),
    );

    const readyIds = new Set(ready.map((task) => task.id));
    setState({
      ...state,
      tasks: state.tasks.map((task) => (readyIds.has(task.id) ? { ...task, status: 'running' as const } : task)),
    });

    const resultsById = new Map(state.tasks.filter(isFinished).map((task) => [task.id, task.result]));

    return ready.map((task) => {
      const dependencyContext = task.dependsOn
        .map((id) => `## Result of "${id}"\n${formatResult(resultsById.get(id))}`)
        .join('\n\n');

      return {
        taskId: task.id,
        agent: task.agent,
        prompt: dependencyContext
          ? `${task.prompt}\n\n# Results of the tasks this depends on\n${dependencyContext}`
          : task.prompt,
      };
    });
  },
});

function formatResult(result: unknown): string {
  if (result === undefined || result === null) {
    return '(no result)';
  }
  return typeof result === 'string' ? result : JSON.stringify(result);
}

const executeTaskStep = createStep({
  id: 'execute-task',
  description: 'Run a single DAG task by calling the agent it was assigned to',
  inputSchema: taskExecutionSchema,
  outputSchema: taskResultSchema,
  execute: async ({ inputData }) => {
    const agent = (await getAgentsById()).get(inputData.agent);
    if (!agent) {
      return {
        taskId: inputData.taskId,
        result: `No agent named "${inputData.agent}" is available.`,
        failed: true,
      };
    }

    console.log(`→ Delegating to: ${inputData.agent} (task: ${inputData.taskId})`);

    try {
      const response = await agent.generate([{ role: 'user', content: inputData.prompt }]);
      console.log(`✓ Completed: ${inputData.agent} (task: ${inputData.taskId})`);
      return { taskId: inputData.taskId, result: response.text ?? '', failed: false };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`✗ Failed: ${inputData.agent} (task: ${inputData.taskId})`, error);
      return { taskId: inputData.taskId, result: `Task failed: ${message}`, failed: true };
    }
  },
});

const recordTaskResultsStep = createStep({
  id: 'record-task-results',
  description: 'Write the results of the wave back into the DAG state',
  inputSchema: z.array(taskResultSchema),
  outputSchema: waveSignalSchema,
  stateSchema: dagSchema,
  execute: async ({ inputData, state, setState }) => {
    const resultsById = new Map(inputData.map((result) => [result.taskId, result]));

    let tasks = state.tasks.map((task) => {
      const result = resultsById.get(task.id);
      if (!result) {
        return task;
      }
      return { ...task, status: result.failed ? ('failed' as const) : ('completed' as const), result: result.result };
    });

    // Nothing ran and work is still outstanding: the remaining dependencies can
    // never be satisfied, so fail them rather than spinning forever.
    if (inputData.length === 0 && tasks.some((task) => !isFinished(task))) {
      const stuck = tasks.filter((task) => !isFinished(task)).map((task) => task.id);
      console.warn(`Routing DAG stalled with unsatisfiable dependencies: ${stuck.join(', ')}`);
      tasks = tasks.map((task) =>
        isFinished(task)
          ? task
          : {
              ...task,
              status: 'failed' as const,
              result: 'Task was skipped: its dependencies could not be satisfied.',
            },
      );
    }

    setState({ ...state, tasks });

    return { isComplete: tasks.every(isFinished) };
  },
});

const reportProgressStep = createStep({
  id: 'report-progress',
  description: 'Suspend with the results of this wave so the caller can relay them',
  inputSchema: waveSignalSchema,
  outputSchema: waveSignalSchema,
  stateSchema: dagSchema,
  suspendSchema: instructionsOutputSchema,
  resumeSchema: z.object({ acknowledged: z.boolean().default(true) }),
  execute: async ({ inputData, resumeData, state, setState, suspend }) => {
    // The final wave is reported by `finalizeStep` as the workflow's result,
    // so there is nothing to suspend for once everything has finished.
    if (inputData.isComplete || resumeData) {
      return inputData;
    }

    const tasks = state.tasks.map((task) => ({ ...task }));
    const report = buildProgressReport(tasks);
    setState({ ...state, tasks });

    await suspend(report);
    return inputData;
  },
});

/**
 * One pass over the DAG: take every task whose dependencies are satisfied, run
 * them against their agents in parallel, record what came back, then suspend so
 * the caller can relay the news before the next pass starts.
 */
const routingWaveWorkflow = createWorkflow({
  id: 'routingWaveWorkflow',
  description: 'Executes one wave of ready DAG tasks and reports the results',
  inputSchema: waveSignalSchema,
  outputSchema: waveSignalSchema,
  stateSchema: dagSchema,
})
  .then(selectReadyTasksStep)
  .foreach(executeTaskStep, { concurrency: TASK_CONCURRENCY })
  .then(recordTaskResultsStep)
  .then(reportProgressStep)
  .commit();

const finalizeStep = createStep({
  id: 'finalize-routing',
  description: 'Report the results of the final wave',
  inputSchema: waveSignalSchema,
  outputSchema: instructionsOutputSchema,
  stateSchema: dagSchema,
  execute: async ({ state, setState }) => {
    const tasks = state.tasks.map((task) => ({ ...task }));
    const report = buildProgressReport(tasks);
    setState({ ...state, tasks });

    return { ...report, instructions: ALL_TASKS_COMPLETED_INSTRUCTIONS, taskIdsInProgress: [] };
  },
});

/**
 * The routing DAG as a first-class Mastra workflow.
 *
 * Run it directly from Mastra Studio to plan a graph, watch each task call its
 * agent, and step through the suspend/resume handshake that the MCP tools drive
 * in production.
 */
export const routingWorkflow = createWorkflow({
  id: 'routingWorkflow',
  mastra: getWorkflowRuntime(),
  description: 'Plans a DAG of agent tasks for a user query and executes it wave by wave',
  inputSchema: z.object({ userQuery: inputSchema.shape.userQuery }),
  outputSchema: instructionsOutputSchema,
  stateSchema: dagSchema,
})
  .then(planTasksStep)
  .then(handOffStep)
  .dountil(routingWaveWorkflow, async ({ inputData }) => inputData.isComplete === true)
  .then(finalizeStep)
  .commit();

/* -------------------------------------------------------------------------- */
/* Active run bookkeeping                                                     */
/* -------------------------------------------------------------------------- */
/*
 * The MCP contract is two stateless tools, so we keep a pointer to the run they
 * are talking about. That pointer plus the in-flight promise is the only state
 * that lives outside the workflow — everything about the DAG itself is workflow
 * state, persisted with the run snapshot.
 */

type RoutingRun = Awaited<ReturnType<typeof routingWorkflow.createRun>>;
type RoutingResult = Awaited<ReturnType<RoutingRun['start']>>;

interface ActiveRouting {
  run: RoutingRun;
  dag: Dag;
  lastReport: z.infer<typeof instructionsOutputSchema>;
  finished: boolean;
  inFlight?: Promise<void>;
}

let activeRouting: ActiveRouting | undefined;

/** Returns the DAG of the most recent routing request. Primarily for tests and Studio. */
export function getCurrentDAG(): Dag {
  return activeRouting?.dag ?? emptyDag();
}

/**
 * Finds the report a suspended run is carrying. Suspend payloads are keyed by
 * the path of the step that suspended, so the report sits one or two levels
 * down depending on whether it came from the hand-off or from a wave.
 */
function readSuspendPayload(payload: unknown): z.infer<typeof instructionsOutputSchema> | undefined {
  if (payload === null || typeof payload !== 'object') {
    return undefined;
  }

  const report = instructionsOutputSchema.safeParse(payload);
  if (report.success) {
    return report.data;
  }

  for (const value of Object.values(payload)) {
    const nested = readSuspendPayload(value);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

function applyResult(routing: ActiveRouting, result: RoutingResult): void {
  const state = dagSchema.safeParse(result.state);
  if (state.success) {
    routing.dag = state.data;
  }

  if (result.status === 'suspended') {
    const report = readSuspendPayload(result.suspendPayload);
    if (report) {
      routing.lastReport = report;
    }
    return;
  }

  routing.finished = true;

  if (result.status === 'success') {
    const parsed = instructionsOutputSchema.safeParse(result.result);
    routing.lastReport = parsed.success ? parsed.data : { instructions: ALL_TASKS_COMPLETED_INSTRUCTIONS };
    return;
  }

  const error = result.status === 'failed' ? result.error : undefined;
  const message = error instanceof Error ? error.message : String(error ?? `status ${result.status}`);
  routing.lastReport = {
    instructions: `The request could not be completed: ${message}. ${INSTRUCTIONS.summarize}`,
    taskIdsInProgress: [],
  };
}

/**
 * Runs `operation` against the active routing run, making sure only one
 * start/resume is ever in flight — a second poll waits on the first instead of
 * resuming a run that is already moving.
 */
function beginOperation(routing: ActiveRouting, operation: () => Promise<RoutingResult>): Promise<void> {
  if (routing.inFlight) {
    return routing.inFlight;
  }

  const inFlight = operation()
    .then((result) => applyResult(routing, result))
    .catch((error: unknown) => {
      routing.finished = true;
      const message = error instanceof Error ? error.message : String(error);
      console.error('Routing workflow failed:', error);
      routing.lastReport = {
        instructions: `The request could not be completed: ${message}. ${INSTRUCTIONS.summarize}`,
        taskIdsInProgress: [],
      };
    })
    .finally(() => {
      if (routing.inFlight === inFlight) {
        routing.inFlight = undefined;
      }
    });

  routing.inFlight = inFlight;
  return inFlight;
}

function resumeRouting(routing: ActiveRouting): Promise<void> {
  if (routing.finished) {
    return Promise.resolve();
  }
  return beginOperation(routing, () =>
    routing.run.resume({
      resumeData: { acknowledged: true },
      outputOptions: { includeState: true },
    }),
  );
}

/** Resolves to `true` if the work landed before the deadline. */
async function withDeadline(work: Promise<void>, deadlineMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), deadlineMs);
  });

  try {
    return await Promise.race([work.then(() => true), timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/** Keeps resuming until the DAG is done. Used for fire-and-forget requests. */
async function driveToCompletion(routing: ActiveRouting): Promise<void> {
  while (!routing.finished) {
    await resumeRouting(routing);
  }
}

/* -------------------------------------------------------------------------- */
/* MCP-facing workflows                                                       */
/* -------------------------------------------------------------------------- */

const routePromptStep = createStep({
  id: 'route-prompt',
  description: 'Plan the routing DAG for a user query and start executing it',
  inputSchema: inputSchema,
  outputSchema: routeAcknowledgementSchema,
  execute: async ({ inputData }) => {
    const run = await routingWorkflow.createRun();
    const routing: ActiveRouting = {
      run,
      dag: { userQuery: inputData.userQuery, tasks: [] },
      lastReport: { instructions: INSTRUCTIONS.poll, taskIdsInProgress: [] },
      finished: false,
    };
    activeRouting = routing;

    const started = beginOperation(routing, () =>
      run.start({
        inputData: { userQuery: inputData.userQuery },
        initialState: emptyDag(),
        outputOptions: { includeState: true },
      }),
    );

    const landed = await withDeadline(started, POLL_DEADLINE_MS);

    if (inputData.async) {
      // Nobody is going to poll for us, so drive the DAG to the end ourselves.
      void driveToCompletion(routing);
      return {
        instructions: INSTRUCTIONS.async,
        taskIdsInProgress: landed ? (routing.lastReport.taskIdsInProgress ?? []) : [],
      };
    }

    return {
      instructions: INSTRUCTIONS.poll,
      taskIdsInProgress: landed ? (routing.lastReport.taskIdsInProgress ?? []) : [],
    };
  },
});

export const routePromptWorkflow = createWorkflow({
  id: 'routePromptWorkflow',
  description: 'Workflow to route a user prompt to appropriate agents via a planned DAG of tasks',
  inputSchema: inputSchema,
  outputSchema: routeAcknowledgementSchema,
})
  .then(routePromptStep)
  .commit();

const getNextInstructionsStep = createStep({
  id: 'get-next-instructions',
  description: 'Resume the routing DAG and return whatever it has finished since the last call',
  inputSchema: z.object({}),
  outputSchema: instructionsOutputSchema,
  execute: async () => {
    const routing = activeRouting;
    if (!routing) {
      return { instructions: INSTRUCTIONS.stillProcessing };
    }

    if (routing.finished && !routing.inFlight) {
      return routing.lastReport;
    }

    const landed = await withDeadline(resumeRouting(routing), POLL_DEADLINE_MS);
    if (!landed) {
      return { instructions: INSTRUCTIONS.stillProcessing };
    }

    console.log('getNextInstructionsWorkflow result:', routing.lastReport);
    return routing.lastReport;
  },
});

export const getNextInstructionsWorkflow = createWorkflow({
  id: 'getNextInstructionsWorkflow',
  description: 'Workflow to wait for next instructions based on DAG state',
  inputSchema: z.object({}),
  outputSchema: instructionsOutputSchema,
})
  .then(getNextInstructionsStep)
  .commit();

export const getCurrentDagWorkflow = createWorkflow({
  id: 'getCurrentDagWorkflow',
  description: 'Workflow to inspect the DAG of the current routing request',
  inputSchema: z.object({}),
  outputSchema: dagSchema,
})
  .then(
    createStep({
      id: 'get-current-dag',
      description: 'Get the current DAG of tasks',
      inputSchema: z.object({}),
      outputSchema: dagSchema,
      execute: async () => getCurrentDAG(),
    }),
  )
  .commit();
