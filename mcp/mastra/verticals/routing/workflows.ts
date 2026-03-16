import type { Agent } from '@mastra/core/agent';
import z from 'zod';
import { createStep, createWorkflow } from '../../utils';
import { getPublicAgents } from '..';
import { getRoutingSupervisorAgent } from './agents.js';

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

export const dagSchema = outputSchema.extend({
  executionPromise: z.promise(z.void()).optional().describe('Internal promise tracking DAG execution'),
  tasks: z.array(
    outputTaskSchema.extend({
      executionPromise: z.promise(outputTaskSchema).optional().describe('Internal promise tracking task execution'),
      result: z.unknown().optional().describe('Result of the task execution'),
      reported: z.boolean().optional().describe('Whether the task result has been reported back to Jarvis'),
    }),
  ),
});

export type AgentProvider = () => Promise<Agent[]>;

/**
 * A function that executes the supervisor's routing logic.
 * It receives the user query and available agents, and is responsible for
 * populating tasks in the workflow state via injectTask/simulateTaskCompletion.
 * Used for testing to inject mock behavior.
 */
export type SupervisorExecutor = (userQuery: string, agents: Agent[]) => Promise<void>;

/**
 * Workflow state that contains all globally needed state for routing workflows.
 * This can be replaced by tests for mocking purposes.
 */
export interface WorkflowState {
  agentProvider: AgentProvider;
  supervisorExecutor?: SupervisorExecutor;
  taskCompletedListeners: Array<(task: z.infer<typeof outputTaskSchema>) => void>;
  currentDAG: z.infer<typeof dagSchema>;
}

function createDefaultWorkflowState(): WorkflowState {
  return {
    agentProvider: getPublicAgents,
    taskCompletedListeners: [],
    currentDAG: {
      tasks: [],
      executionPromise: undefined,
    },
  };
}

let workflowState: WorkflowState = createDefaultWorkflowState();

/**
 * Sets the entire workflow state. Use this in tests to inject mock state.
 * If no state is provided, resets to the default state.
 */
export function setWorkflowState(state?: Partial<WorkflowState>): void {
  if (!state) {
    workflowState = createDefaultWorkflowState();
  } else {
    workflowState = {
      ...createDefaultWorkflowState(),
      ...state,
    };
  }
}

/**
 * Gets the current workflow state. Primarily useful for tests.
 */
export function getWorkflowState(): WorkflowState {
  return workflowState;
}

// Backward-compatible accessors - delegating to workflowState

export function setAgentProvider(provider: AgentProvider): void {
  workflowState.agentProvider = provider;
}

export function resetAgentProvider(): void {
  workflowState.agentProvider = getPublicAgents;
}

export function getTaskCompletedListenersCount(): number {
  return workflowState.taskCompletedListeners.length;
}

export function clearTaskCompletedListeners(): void {
  workflowState.taskCompletedListeners.length = 0;
}

export function resetCurrentDAG() {
  workflowState.currentDAG = {
    tasks: [],
    executionPromise: undefined,
  };
}

export function getCurrentDAG(): z.infer<typeof dagSchema> {
  return workflowState.currentDAG;
}

export function injectTask(task: z.infer<typeof outputTaskSchema>): void {
  workflowState.currentDAG.tasks.push({ ...task, executionPromise: undefined, result: undefined, reported: undefined });
}

export function simulateTaskCompletion(taskId: string, result: unknown): void {
  const task = workflowState.currentDAG.tasks.find((t) => t.id === taskId);
  if (!task) {
    throw new Error(`Task with ID ${taskId} not found`);
  }
  task.result = result;

  for (const listener of workflowState.taskCompletedListeners) {
    listener(task);
  }
}

/**
 * Executes the supervisor agent with delegation hooks to track task progress.
 * Uses the injected supervisorExecutor if available (for testing), otherwise
 * creates a real supervisor agent that delegates to sub-agents.
 */
async function startSupervisorExecution(userQuery: string, agents: Agent[]): Promise<void> {
  if (workflowState.supervisorExecutor) {
    return workflowState.supervisorExecutor(userQuery, agents);
  }

  const agentsMap: Record<string, Agent> = {};
  for (const agent of agents) {
    agentsMap[agent.id] = agent;
  }

  const supervisor = await getRoutingSupervisorAgent(agentsMap);
  let delegationCounter = 0;
  // Map toolCallId → taskId to correctly match concurrent delegations to the same agent
  const toolCallToTask = new Map<string, string>();
  // Track completed task IDs per iteration so later delegations can depend on earlier ones
  const completedTaskIdsByIteration = new Map<number, string[]>();

  try {
    // maxSteps limits the total number of LLM iterations the supervisor can perform.
    // 10 is sufficient for most multi-agent routing scenarios while preventing runaway loops.
    await supervisor.generate([{ role: 'user', content: userQuery }], {
      maxSteps: 10,
      modelSettings: { temperature: 0 },
      delegation: {
        onDelegationStart: async (ctx) => {
          delegationCounter++;
          const taskId = `${ctx.primitiveId}-delegation-${delegationCounter}`;
          toolCallToTask.set(ctx.toolCallId, taskId);

          // Tasks in later iterations depend on all tasks completed in prior iterations
          const dependsOn: string[] = [];
          for (let i = 1; i < ctx.iteration; i++) {
            const ids = completedTaskIdsByIteration.get(i);
            if (ids) {
              dependsOn.push(...ids);
            }
          }

          workflowState.currentDAG.tasks.push({
            id: taskId,
            agent: ctx.primitiveId,
            prompt: ctx.prompt,
            dependsOn,
          });
          console.log(`→ Delegating to: ${ctx.primitiveId} (task: ${taskId}, dependsOn: [${dependsOn.join(', ')}])`);
          return { proceed: true };
        },
        onDelegationComplete: async (ctx) => {
          const taskId = toolCallToTask.get(ctx.toolCallId);
          const task = taskId ? workflowState.currentDAG.tasks.find((t) => t.id === taskId) : undefined;
          if (task) {
            task.result = ctx.result?.text || '';

            // Track which tasks completed in which iteration for dependency inference
            const iterationTasks = completedTaskIdsByIteration.get(ctx.iteration) || [];
            iterationTasks.push(task.id);
            completedTaskIdsByIteration.set(ctx.iteration, iterationTasks);

            console.log(`✓ Completed: ${ctx.primitiveId} (task: ${task.id})`);
            for (const listener of workflowState.taskCompletedListeners) {
              listener(task);
            }
          }
        },
      },
    });

    console.log('Supervisor execution complete.');
  } catch (error) {
    console.error('Supervisor execution failed:', error);
  } finally {
    workflowState.currentDAG.executionPromise = undefined;
  }
}

const routeWithSupervisorStep = createStep({
  id: 'route-with-supervisor',
  description: 'Route user prompt via supervisor agent that delegates to sub-agents',
  inputSchema: inputSchema,
  outputSchema: z.object({
    instructions: z.string().describe('Instructions for Jarvis to follow'),
    taskIdsInProgress: z.array(z.string()).describe('IDs of tasks currently in progress'),
  }),
  execute: async (context) => {
    if (!workflowState.currentDAG.executionPromise) {
      const agents = await workflowState.agentProvider();
      workflowState.currentDAG.executionPromise = startSupervisorExecution(context.inputData.userQuery, agents);
    }

    const isAsync = context.inputData.async === true;
    const taskIdsInProgress = workflowState.currentDAG.tasks.filter((t) => t.result === undefined).map((t) => t.id);

    if (isAsync) {
      return {
        instructions:
          'The request is being processed in the background and will complete on its own. End the call now.',
        taskIdsInProgress,
      };
    }

    return {
      instructions:
        'The request is now being processed in the background. Call getNextInstructionsWorkflow to check on the status and receive the next instructions.',
      taskIdsInProgress,
    };
  },
});

export const getCurrentDagWorkflow = createWorkflow({
  id: 'getCurrentDagWorkflow',
  inputSchema: z.object({}),
  outputSchema: dagSchema,
})
  .then(
    createStep({
      id: 'get-current-dag',
      description: 'Get the current DAG of tasks',
      inputSchema: z.object({}),
      outputSchema: dagSchema,
      execute: async () => {
        return workflowState.currentDAG;
      },
    }),
  )
  .commit();

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

const getNextInstructionsStep = createStep({
  id: 'get-next-instructions',
  description: 'Get next instructions based on DAG state',
  inputSchema: z.object({}),
  outputSchema: instructionsOutputSchema,
  execute: async () => {
    async function waitForNextInstructions(): Promise<z.infer<typeof instructionsOutputSchema>> {
      const tasks = workflowState.currentDAG.tasks;

      const completedUnreportedTasks = tasks.filter((t) => t.result !== undefined && !t.reported);
      if (completedUnreportedTasks.length === 0) {
        const completedTask = await waitForNextCompletedTask();
        completedUnreportedTasks.push(completedTask);
      }

      const allResults = completedUnreportedTasks.map((t) => ({
        task: t,
        isLeaf: !tasks.some((other) => other.dependsOn.includes(t.id)),
      }));

      //we want to report leaves first if they exist, because leaves contain the *final* information that the user asked for. other nodes are just intermediary.
      const leafResults = allResults.filter((x) => x.isLeaf);
      const resultsToUse = leafResults.length > 0 ? leafResults : allResults;
      for (const result of resultsToUse) {
        result.task.reported = true;
      }

      const isLeaf = resultsToUse.some((x) => x.isLeaf);

      const areAllTasksCompleted = tasks.every((t) => t.result !== undefined);
      if (areAllTasksCompleted) {
        //reset DAG for next time
        setTimeout(() => resetCurrentDAG(), 10_000);
      }

      const summarizeCompletedTasksInstruction = 'Summarize the new completed task results in a detailed manner.';

      let instructions = '';
      if (areAllTasksCompleted) {
        instructions = `All tasks have completed. ${summarizeCompletedTasksInstruction}`;
      } else {
        instructions = `More tasks have finished since last time, but not all tasks have completed yet. `;
        instructions += isLeaf
          ? `${summarizeCompletedTasksInstruction}`
          : 'Mention briefly that you have received the information in less than 5 words.';
        instructions += `, then call getNextInstructionsWorkflow again.`;
      }

      return {
        instructions: instructions,
        completedTaskResults: allResults.map((x) => ({
          id: x.task.id,
          result: isLeaf ? x.task.result : undefined,
        })),
        taskIdsInProgress: isLeaf ? tasks.filter((t) => t.result === undefined).map((t) => t.id) : undefined,
      };
    }

    const result = await Promise.race<z.infer<typeof instructionsOutputSchema>>([
      waitForNextInstructions(),
      new Promise<z.infer<typeof instructionsOutputSchema>>((resolve) =>
        setTimeout(
          () =>
            resolve({
              instructions:
                'Still processing your request. Call getNextInstructionsWorkflow again to wait a bit longer for it to complete.',
            }),
          15000,
        ),
      ),
    ]);
    console.log('getNextInstructionsWorkflow result:', result);

    return result;
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

export const routePromptWorkflow = createWorkflow({
  id: 'routePromptWorkflow',
  description: 'Workflow to route a user prompt to appropriate agents via a supervisor agent',
  inputSchema: inputSchema,
  outputSchema: routeWithSupervisorStep.outputSchema,
})
  .then(routeWithSupervisorStep)
  .commit();

async function waitForNextCompletedTask() {
  return new Promise<z.infer<typeof outputTaskSchema>>((resolve) => {
    var listener = (task: z.infer<typeof outputTaskSchema>) => {
      console.log('Next completed task', task.id);
      resolve(task);

      const index = workflowState.taskCompletedListeners.indexOf(listener);
      if (index !== -1) {
        workflowState.taskCompletedListeners.splice(index, 1);
      }
    };
    workflowState.taskCompletedListeners.push(listener);
  });
}
