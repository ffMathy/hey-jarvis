import { chain, keyBy, take } from "lodash-es";
import { getPublicAgents } from "..";
import { createAgentStep, createStep, createWorkflow, google } from "../../utils";
import z from "zod";

const outputTaskSchema = z.object({
    id: z.string().describe("The unique task ID for this task"),
    agent: z.string().describe("Agent ID to use for this task"),
    prompt: z.string().describe("Input to provide to the agent for this task"),
    dependsOn: z.array(z.string()).describe("IDs of tasks this task depends on"),
});

const outputSchema = z.object({
    isAsync: z.boolean().default(false),
    tasks: z.array(outputTaskSchema)
}).describe("The generated DAG of tasks to fulfill the routing query");

const stateSchema = z.object({
    userQuery: z.string().describe("The user's routing query"),
}).partial();

const inputSchema = z.object({
    userQuery: z.string().describe("The user's routing query").default("I'd like to check the weather for my current location, and check my calendar for today. If I have any calendars regarding my workplace, I'd like to infer when I typically go to work, and check the traffic conditions for that time. Additionally, I am planning on making a lasagna, so please fetch the recipes for that and add a reminder to my to-do list with the ingredients, for when I get home from work."),
});

const dagSchema = outputSchema.extend({
    executionPromise: z.promise(z.void()).optional().describe("Internal promise tracking DAG execution"),
    tasks: z.array(outputTaskSchema.extend({
        executionPromise: z.promise(outputTaskSchema).optional().describe("Internal promise tracking task execution"),
        result: z.any().optional().describe("Result of the task execution"),
        reported: z.boolean().optional().describe("Whether the task result has been reported back to Jarvis"),
    }))
});

const currentDAG: z.infer<typeof dagSchema> = {
    tasks: [],
    executionPromise: undefined,
};

const listAvailableAgentsStep = createStep({
    id: 'list-available-agents',
    description: 'List all available agents for routing',
    inputSchema: inputSchema,
    stateSchema: stateSchema,
    outputSchema: z.object({
        agents: z.array(z.object({
            id: z.string(),
            description: z.string(),
        })),
    }),
    execute: async (context) => {
        context.setState({
            userQuery: context.inputData.userQuery,
        });

        const publicAgents = Object.values(await getPublicAgents());
        const agentsById = publicAgents.map(x => ({ id: x.id || x.name, description: x.getDescription() }));
        return { agents: agentsById };
    }
});

function truncateLog(text: string, maxLength: number): string {
    if (!text)
        return '';

    text = text.split('\n').map(x => x.trim()).filter(x => x).join('  ');
    if (text.length <= maxLength) {
        return text;
    }
    return text.slice(0, maxLength) + '...';
}

async function startDagExecution() {
    const publicAgents = Object.values(await getPublicAgents());
    const agentsById = keyBy(publicAgents, 'id');
    const tasks = currentDAG.tasks;

    const executeTask = async (task: typeof tasks[0]) => {
        const agent = agentsById[task.agent];
        if (!agent) {
            throw new Error(`Agent with ID ${task.agent} not found`);
        }

        // Gather context from completed dependencies
        const contextParts: string[] = [];
        for (const dependencyId of task.dependsOn) {
            const dependencyTask = tasks.find(t => t.id === dependencyId);
            if (dependencyTask && dependencyTask.result) {
                contextParts.push(`## ${dependencyTask.id} result\n\`\`\`json\n${JSON.stringify(dependencyTask.result)}\n\`\`\``);
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

        return task;
    };

    while(true) {
        const tasksWithoutPromises = chain(currentDAG.tasks)
            .filter(t => !t.executionPromise)
            .orderBy(x => x.dependsOn.length)
            .value();
        if( tasksWithoutPromises.length === 0 ) {
            break;
        }

        for(const task of tasksWithoutPromises) {
            const dependencies = task.dependsOn;
            const dependencyPromise = Promise.all(dependencies.map(dependencyId => {
                const dependencyTask = currentDAG.tasks.find(t => t.id === dependencyId);
                if (!dependencyTask || !dependencyTask.executionPromise) {
                    throw new Error(`Dependency task with ID ${dependencyId} not found or not started for task ${task.id}`);
                }
                return dependencyTask.executionPromise;
            }));
            task.executionPromise = dependencyPromise.then(() => executeTask(task));
        }
    }

    await Promise.all(currentDAG.tasks.map(t => t.executionPromise));

    console.log("DAG execution complete.");

    currentDAG.executionPromise = undefined;
}

const generateDagStep = createAgentStep({
    id: 'generate-dag',
    description: 'Generate DAG of tasks to fulfill routing query',
    agentConfig: {
        model: google('gemini-flash-lite-latest'),
        id: 'dag-agent',
        name: 'DagAgent',
        instructions: `
                You will be given a prompt that you need to decompose into a series of tasks (in DAG-like format) to be executed using available agents. 
                Each task in the DAG should have a unique ID, specify which tool to use, and list any dependencies on other tasks.
                You must not instruct a agent to do or ask about something something that it does not have the capability to do.
                If an agent needs something that you have not yet been provided with from any agent, you must include another task in the DAG to obtain that information first from a different agent, and list that task as a dependency via \`dependsOn\`.
                The prompts must not contain any meta information about the DAG or its tasks themselves, as the agents cannot access that information.
                If the user is in a rush or states that it's not important to wait for the information to come back, then set \`isAsync\` to true.
                You will also be given a list of tasks that are already running. Only create new tasks for things that are not already being handled by existing tasks.
                `,
    },
    inputSchema: listAvailableAgentsStep.outputSchema,
    outputSchema: outputSchema,
    stateSchema: stateSchema,
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
            ${JSON.stringify(currentDAG.tasks, null, 2)}
            \`\`\`
        `;
    },
});

const mergeDagStep = createStep({
    id: 'merge-dag',
    description: 'Merge newly generated DAG with current DAG of tasks',
    inputSchema: generateDagStep.outputSchema,
    stateSchema: stateSchema,
    outputSchema: outputSchema,
    execute: async (context) => {
        const newTasks = context.inputData.tasks;
        const mergedTasks = [...currentDAG.tasks];

        const existingTaskIds = new Set(mergedTasks.map(t => t.id));
        for (const newTask of newTasks) {
            if (!existingTaskIds.has(newTask.id)) {
                mergedTasks.push(newTask);
            }
        }

        currentDAG.tasks = mergedTasks;
        return currentDAG;
    }
});

const optimizeDagStep = createStep({
    id: 'optimize-dag',
    description: 'Optimize DAG by compressing sequential tasks for the same agent',
    inputSchema: mergeDagStep.outputSchema,
    stateSchema: stateSchema,
    outputSchema: outputSchema,
    execute: async (context) => {
        const tasks = currentDAG.tasks;

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
                const internalDeps = task.dependsOn.filter(depId => tasksById[depId]);
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
                        const hasExternalDeps = otherTask.dependsOn.some(
                            depId => !tasksById[depId] && depId !== taskId
                        );
                        if (!hasExternalDeps) {
                            buildChain(otherTask.id, chain);
                        }
                    }
                }
            };

            const rootTasks = agentTasks.filter(task => {
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
                    const mergedId = chain.map(t => t.id).join('+');
                    const mergedPrompt = chain.map(t => t.prompt).join('\nThen:\n');
                    const externalDeps = chain.flatMap(t => t.dependsOn)
                        .filter(depId => !chain.some(ct => ct.id === depId));

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

        const finalTasks = optimizedTasks.map(task => ({
            ...task,
            dependsOn: task.dependsOn.map(depId => mergedTaskIds.get(depId) || depId),
        }));
        currentDAG.tasks = finalTasks;

        return currentDAG;
    }
});

const startDagExecutionStep = createStep({
    id: 'start-dag-execution',
    description: 'Start execution of DAG tasks',
    inputSchema: optimizeDagStep.outputSchema,
    stateSchema: stateSchema,
    outputSchema: z.object({
        taskIdsInProgress: z.array(z.string()).describe("IDs of tasks currently in progress"),
    }),
    execute: async () => {
        if (!currentDAG.executionPromise) {
            currentDAG.executionPromise = startDagExecution();
        }
        
        return {
            taskIdsInProgress: currentDAG.tasks
                .filter(t => t.result === undefined)
                .map(t => t.id),
        }
    }
});

export const getCurrentDagWorkflow = createWorkflow({
    id: "getCurrentDagWorkflow",
    inputSchema: z.object({}),
    outputSchema: dagSchema,
})
    .then(createStep({
        id: 'get-current-dag',
        description: 'Get the current DAG of tasks',
        inputSchema: z.object({}),
        outputSchema: dagSchema,
        execute: async () => {
            return currentDAG;
        }
    }))
    .commit();

const instructionsOutputSchema = z.object({
    instructions: z.string().describe("Instructions for Jarvis to follow"),
    completedTaskResults: z.array(z.object({
        id: z.string().describe("The unique task ID"),
        result: z.any().describe("Result of the task execution"),
    })).optional().describe("Results of completed tasks, if any"),
    taskIdsInProgress: z.array(z.string()).optional().describe("IDs of tasks still pending"),
});

const getNextInstructionsStep = createStep({
    id: 'get-next-instructions',
    description: 'Get next instructions based on DAG state',
    inputSchema: z.object({}),
    outputSchema: instructionsOutputSchema,
    execute: async () => {
        async function waitForNextInstructions(): Promise<z.infer<typeof instructionsOutputSchema>> {
            const tasks = currentDAG.tasks;

            const completedUnreportedTasks = tasks.filter(t => t.result !== undefined && !t.reported);
            if(completedUnreportedTasks.length === 0) {
                const completedTask = await Promise.race(completedUnreportedTasks.map(t => t.executionPromise));
                completedUnreportedTasks.push(completedTask);
            }

            const allResults = completedUnreportedTasks
                .map(t => ({
                    task: t,
                    isLeaf: !tasks.some(other => other.dependsOn.includes(t.id)),
                }));

            //we want to report leaves first if they exist, because leaves contain the *final* information that the user asked for. other nodes are just intermediary.
            const leafResults = allResults.filter(x => x.isLeaf);
            const resultsToUse = leafResults.length > 0 ? leafResults : allResults;
            for(const result of resultsToUse) {
                result.task.reported = true;
            }

            const areAllTasksCompleted = tasks.every(t => t.result !== undefined);
            
            return {
                instructions: areAllTasksCompleted
                    ? "All tasks have completed. Summarize the final results in a detailed manner."
                    : "More tasks have finished since last time, but not all tasks have completed yet. Summarize only the key bits of the preliminary findings very briefly, then call getNextInstructionsWorkflow again.",
                completedTaskResults: allResults.map(x => ({ 
                    id: x.task.id, 
                    result: x.task.result 
                })),
                taskIdsInProgress: tasks.filter(t => t.result === undefined).map(t => t.id),
            };
        }

        const result = await Promise.race([
            waitForNextInstructions(),
            new Promise(resolve => setTimeout(() => resolve({
                instructions: "Still processing your request. Call getNextInstructionsWorkflow again to wait a bit longer for it to complete."
            }), 10000))
        ]);

        return result;
    }
});

export const getNextInstructionsWorkflow = createWorkflow({
    id: "getNextInstructionsWorkflow",
    inputSchema: z.object({}),
    outputSchema: instructionsOutputSchema,
})
    .then(getNextInstructionsStep)
    .commit();

export const routePromptWorkflow = createWorkflow({
    id: "routePromptWorkflow",
    inputSchema: inputSchema,
    outputSchema: outputSchema,
    stateSchema: stateSchema
})
    .then(listAvailableAgentsStep)
    .then(generateDagStep)
    .then(mergeDagStep)
    .then(optimizeDagStep)
    .then(startDagExecutionStep)
    .commit();