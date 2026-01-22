import type { Agent } from '@mastra/core/agent';
import { chain, keyBy } from 'lodash-es';
import z from 'zod';
import { createAgentStep, createStep, createWorkflow, getModel } from '../../utils';
import { getPublicAgents } from '..';

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

const stateSchema = z
  .object({
    userQuery: z.string().describe("The user's routing query"),
    async: z.boolean().describe('Whether the DAG is running asynchronously (fire-and-forget)'),
  })
  .partial();

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
      result: z.any().optional().describe('Result of the task execution'),
      reported: z.boolean().optional().describe('Whether the task result has been reported back to Jarvis'),
    }),
  ),
});

export type AgentProvider = () => Promise<Agent[]>;

/**
 * Workflow state that contains all globally needed state for routing workflows.
 * This can be replaced by tests for mocking purposes.
 */
export interface WorkflowState {
  agentProvider: AgentProvider;
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

const toolInfoSchema = z.object({
  name: z.string().describe('The tool name/ID'),
  inputParams: z.array(z.string()).describe('Names of input parameters the tool accepts'),
});

const listAvailableAgentsStep = createStep({
  id: 'list-available-agents',
  description: 'List all available agents for routing',
  inputSchema: inputSchema,
  outputSchema: z.object({
    agents: z.array(
      z.object({
        id: z.string(),
        description: z.string(),
        tools: z.array(toolInfoSchema).describe('Tools available to this agent'),
      }),
    ),
  }),
  execute: async (context) => {
    context.setState({
      userQuery: context.inputData.userQuery,
      async: context.inputData.async,
    });

    const publicAgents = Object.values(await workflowState.agentProvider());
    const agentsById = await Promise.all(
      publicAgents.map(async (agent) => {
        const tools = await agent.listTools();
        const toolsInfo = Object.entries(tools || {}).map(([toolName, tool]) => {
          let inputParams: string[] = [];
          const inputSchema = (tool as { inputSchema?: { shape?: Record<string, unknown> } }).inputSchema;
          if (inputSchema && typeof inputSchema === 'object' && 'shape' in inputSchema) {
            inputParams = Object.keys(inputSchema.shape as Record<string, unknown>);
          }
          return {
            name: toolName,
            inputParams,
          };
        });
        return {
          id: agent.id || agent.name,
          description: agent.getDescription(),
          tools: toolsInfo,
        };
      }),
    );
    return { agents: agentsById };
  },
});

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
  workflowState.currentDAG.tasks.push(task as z.infer<typeof dagSchema>['tasks'][0]);
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

function truncateLog(text: string, maxLength: number): string {
  if (!text) return '';

  text = text
    .split('\n')
    .map((x) => x.trim())
    .filter((x) => x)
    .join('  ');
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function drawDAGAsASCIIArt(): void {
  const tasks = workflowState.currentDAG.tasks;
  if (tasks.length === 0) {
    console.log('(empty DAG)');
    return;
  }

  const taskIds = new Set(tasks.map((t) => t.id));
  const rootTasks = tasks.filter((t) => t.dependsOn.length === 0 || t.dependsOn.every((dep) => !taskIds.has(dep)));

  const childrenMap = new Map<string, string[]>();
  for (const task of tasks) {
    for (const parentId of task.dependsOn) {
      if (taskIds.has(parentId)) {
        const children = childrenMap.get(parentId) || [];
        children.push(task.id);
        childrenMap.set(parentId, children);
      }
    }
  }

  const lines: string[] = [];

  const drawTask = (taskId: string, prefix: string, isLast: boolean) => {
    const connector = isLast ? '└── ' : '├── ';
    lines.push(prefix + connector + taskId);

    const children = childrenMap.get(taskId) || [];
    const childPrefix = prefix + (isLast ? '    ' : '│   ');
    children.forEach((childId, index) => {
      drawTask(childId, childPrefix, index === children.length - 1);
    });
  };

  rootTasks.forEach((task, index) => {
    const isLast = index === rootTasks.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    lines.push(connector + task.id);

    const children = childrenMap.get(task.id) || [];
    const childPrefix = isLast ? '    ' : '│   ';
    children.forEach((childId, childIndex) => {
      drawTask(childId, childPrefix, childIndex === children.length - 1);
    });
  });

  console.log(`\n${lines.join('\n')}\n`);
}

async function startDagExecution() {
  const publicAgents = Object.values(await workflowState.agentProvider());
  const agentsById = keyBy(publicAgents, 'id');
  const tasks = workflowState.currentDAG.tasks;

  const executeTask = async (task: (typeof tasks)[0]) => {
    const agent = agentsById[task.agent];
    if (!agent) {
      throw new Error(`Agent with ID ${task.agent} not found`);
    }

    // Gather context from completed dependencies
    const contextParts: string[] = [];
    for (const dependencyId of task.dependsOn) {
      const dependencyTask = tasks.find((t) => t.id === dependencyId);
      if (dependencyTask?.result) {
        contextParts.push(
          `## ${dependencyTask.id} result\n\`\`\`json\n${JSON.stringify(dependencyTask.result)}\n\`\`\``,
        );
      }
    }

    const context = contextParts.join('\n\n');
    const promptWithContext = `
        # Context
        ${context}
        
        # Task Prompt
        ${task.prompt}
    `;

    console.log(`${task.agent}->${task.id}: ${truncateLog(promptWithContext, 100)}`);

    const result = await agent.generate(promptWithContext);
    const output = await Promise.resolve(result.text);
    task.result = output || '';

    console.log(`${task.agent}->${task.id} completed: ${truncateLog(output, 100)}`);

    for (const listener of workflowState.taskCompletedListeners) {
      listener(task);
    }

    return task;
  };

  console.log('Executing DAG...');
  drawDAGAsASCIIArt();

  while (true) {
    const tasksWithoutPromises = chain(workflowState.currentDAG.tasks)
      .filter((t) => !t.executionPromise)
      .orderBy((x) => x.dependsOn.length)
      .value();
    if (tasksWithoutPromises.length === 0) {
      break;
    }

    for (const task of tasksWithoutPromises) {
      const dependencies = task.dependsOn;
      const dependencyPromise = Promise.all(
        dependencies.map((dependencyId) => {
          const dependencyTask = workflowState.currentDAG.tasks.find((t) => t.id === dependencyId);
          if (!dependencyTask || !dependencyTask.executionPromise) {
            throw new Error(`Dependency task with ID ${dependencyId} not found or not started for task ${task.id}`);
          }
          return dependencyTask.executionPromise;
        }),
      );
      task.executionPromise = dependencyPromise.then(() => executeTask(task));
    }
  }

  await Promise.all(workflowState.currentDAG.tasks.map((t) => t.executionPromise));

  console.log('DAG execution complete.');

  workflowState.currentDAG.executionPromise = undefined;
}

const generateDagStep = createAgentStep({
  id: 'generate-dag',
  description: 'Generate DAG of tasks to fulfill routing query',
  agentConfig: {
    model: getModel('gemini-flash-lite-latest'),
    id: 'dag-agent',
    name: 'DagAgent',
    instructions: `You are a task decomposition specialist that converts user queries into Directed Acyclic Graphs (DAGs) of executable tasks.

# Your Role
Analyze the user's query and decompose it into discrete, executable tasks that can be assigned to available agents. Each task forms a node in a DAG where edges represent data dependencies.

# Task Structure Requirements
Each task MUST have:
- \`id\`: A unique, descriptive kebab-case identifier
- \`agent\`: The exact agent ID from the available agents list (case-sensitive match required)
- \`prompt\`: A self-contained instruction that provides ALL context the agent needs
- \`dependsOn\`: Array of task IDs whose outputs are required as input for this task

# Critical Rules

**Agent Capability Matching:**
- ONLY assign tasks that match an agent's stated capabilities in their description
- Review each agent's \`tools\` array to understand EXACTLY what the agent can do
- Each tool has a \`name\` and \`inputParams\` - use these to determine if the agent can fulfill a task
- If no agent has a tool that can handle a sub-task, DO NOT create that task - omit it entirely
- Never assume capabilities not supported by the agent's available tools

**Tool-Based Decision Making:**
- When routing, prefer agents whose tools directly match the required functionality
- If a task requires specific parameters (e.g., location, date), ensure the relevant tool accepts those parameters via its \`inputParams\`
- Multiple tools on an agent mean the agent can perform multiple related actions

**Dependency Graph Construction:**
- If Task B needs data from Task A, Task B MUST list Task A's ID in \`dependsOn\`
- Tasks with no dependencies have empty \`dependsOn: []\` and can run in parallel
- Avoid circular dependencies - the graph must be acyclic

**Prompt Isolation:**
- Each prompt must be fully self-contained - agents cannot see the DAG structure
- Include all necessary context, parameters, and constraints within the prompt itself
- Reference specific data needs: "Get weather for Aarhus, Denmark" not "Get the weather"
- Never reference task IDs, other agents, or DAG metadata in prompts

**Incremental Updates:**
- You will receive a list of already-running tasks - DO NOT recreate them
- Only add NEW tasks for uncovered aspects of the user's query
- If the user's request is fully covered by existing tasks, return empty tasks array

# Output Quality
- Prefer fewer, well-scoped tasks over many granular ones
- Combine related operations for the same agent when logical
- Ensure leaf tasks (those with no dependents) directly address user-facing needs`,
  },
  inputSchema: listAvailableAgentsStep.outputSchema,
  outputSchema: outputSchema,
  prompt: async (context) => {
    return `
            # User query
            > ${context.state.userQuery}

            # Agents available
            \`\`\`json
            ${JSON.stringify(context.inputData.agents, null, 2)}
            \`\`\`

            # Current tasks
            \`\`\`json
            ${JSON.stringify(workflowState.currentDAG.tasks, null, 2)}
            \`\`\`
        `;
  },
});

const mergeDagStep = createStep({
  id: 'merge-dag',
  description: 'Merge newly generated DAG with current DAG of tasks',
  inputSchema: generateDagStep.outputSchema,
  outputSchema: outputSchema,
  execute: async (context) => {
    const newTasks = context.inputData.tasks;
    const mergedTasks = [...workflowState.currentDAG.tasks];

    const existingTaskIds = new Set(mergedTasks.map((t) => t.id));
    for (const newTask of newTasks) {
      if (!existingTaskIds.has(newTask.id)) {
        mergedTasks.push(newTask);
      }
    }

    workflowState.currentDAG.tasks = mergedTasks;

    return workflowState.currentDAG;
  },
});

const optimizeDagStep = createStep({
  id: 'optimize-dag',
  description: 'Optimize DAG by compressing sequential tasks for the same agent',
  inputSchema: mergeDagStep.outputSchema,
  outputSchema: outputSchema,
  execute: async (_context) => {
    const tasks = workflowState.currentDAG.tasks;

    const tasksByAgent = new Map<string, typeof tasks>();
    for (const task of tasks) {
      const agentTasks = tasksByAgent.get(task.agent) || [];
      agentTasks.push(task);
      tasksByAgent.set(task.agent, agentTasks);
    }

    const optimizedTasks: typeof tasks = [];
    const mergedTaskIds = new Map<string, string>();

    for (const [agent, agentTasks] of tasksByAgent) {
      if (agentTasks.length === 1) {
        optimizedTasks.push(agentTasks[0]);
        continue;
      }

      const tasksById = keyBy(agentTasks, 'id');
      const taskDependencies = new Map<string, Set<string>>();

      for (const task of agentTasks) {
        const internalDeps = task.dependsOn.filter((depId) => tasksById[depId]);
        taskDependencies.set(task.id, new Set(internalDeps));
      }

      const visited = new Set<string>();
      const chains: (typeof tasks)[] = [];

      const buildChain = (taskId: string, chain: typeof tasks) => {
        if (visited.has(taskId)) return;
        visited.add(taskId);

        const task = tasksById[taskId];
        if (!task) return;

        chain.push(task);

        for (const otherTask of agentTasks) {
          if (otherTask.dependsOn.includes(taskId) && tasksById[otherTask.id]) {
            const hasExternalDeps = otherTask.dependsOn.some((depId) => !tasksById[depId] && depId !== taskId);
            if (!hasExternalDeps) {
              buildChain(otherTask.id, chain);
            }
          }
        }
      };

      const rootTasks = agentTasks.filter((task) => {
        const deps = taskDependencies.get(task.id) || new Set();
        return deps.size === 0;
      });

      for (const rootTask of rootTasks) {
        if (!visited.has(rootTask.id)) {
          const chain: typeof tasks = [];
          buildChain(rootTask.id, chain);
          if (chain.length > 0) {
            chains.push(chain);
          }
        }
      }

      for (const task of agentTasks) {
        if (!visited.has(task.id)) {
          optimizedTasks.push(task);
        }
      }

      for (const chain of chains) {
        if (chain.length === 1) {
          optimizedTasks.push(chain[0]);
        } else {
          const mergedId = chain.map((t) => t.id).join('+');
          const mergedPrompt = chain.map((t) => t.prompt).join('\nThen:\n');
          const externalDeps = chain
            .flatMap((t) => t.dependsOn)
            .filter((depId) => !chain.some((ct) => ct.id === depId));

          for (const task of chain) {
            mergedTaskIds.set(task.id, mergedId);
          }

          optimizedTasks.push({
            id: mergedId,
            agent: agent,
            prompt: mergedPrompt,
            dependsOn: [...new Set(externalDeps)],
          });
        }
      }
    }

    const finalTasks = optimizedTasks.map((task) => ({
      ...task,
      dependsOn: task.dependsOn.map((depId) => mergedTaskIds.get(depId) || depId),
    }));
    workflowState.currentDAG.tasks = finalTasks;

    return workflowState.currentDAG;
  },
});

const startDagExecutionStep = createStep({
  id: 'start-dag-execution',
  description: 'Start execution of DAG tasks',
  inputSchema: optimizeDagStep.outputSchema,
  outputSchema: z.object({
    instructions: z.string().describe('Instructions for Jarvis to follow'),
    taskIdsInProgress: z.array(z.string()).describe('IDs of tasks currently in progress'),
  }),
  execute: async (context) => {
    if (!workflowState.currentDAG.executionPromise) {
      workflowState.currentDAG.executionPromise = startDagExecution();
    }

    const isAsync = context.state.async === true;
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
        result: z.any().describe('Result of the task execution'),
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
          ...(isLeaf ? { result: x.task.result } : {}),
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
  description: 'Workflow to route a user prompt to appropriate agents via a DAG of tasks',
  inputSchema: inputSchema,
  outputSchema: startDagExecutionStep.outputSchema,
})
  .then(listAvailableAgentsStep)
  .then(generateDagStep)
  .then(mergeDagStep)
  .then(optimizeDagStep)
  .then(startDagExecutionStep)
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
