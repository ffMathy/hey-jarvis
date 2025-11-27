import { find, truncate, uniqueId } from 'lodash-es';
import { z } from 'zod';
import { createTool } from '../../utils/tool-factory.js';

// Type for a task in the execution plan
type Task = {
  runId: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  dependsOn?: string[];
  result?: unknown;
  error?: string;
  promise?: Promise<unknown>;
};

// Type for a plan in the active plans store
type Plan = {
  planId: string;
  query: string;
  tasks: Map<string, Task>;
  startedAt: string;
};

// Schema for a single task in the execution plan
const taskSchema = z.object({
  runId: z.string().describe('The unique identifier for this task run'),
  description: z.string().describe('A description of what this task does'),
  status: z.enum(['pending', 'running', 'completed', 'failed']).describe('The current status of the task'),
  dependsOn: z.array(z.string()).optional().describe('Run IDs of tasks that must complete before this one'),
});

// Schema for the execution plan DAG
const executionPlanSchema = z.object({
  planId: z.string().describe('The unique identifier for this execution plan'),
  query: z.string().describe('The original user query'),
  tasks: z.array(taskSchema).describe('The list of tasks in the execution plan'),
  startedAt: z.string().describe('ISO timestamp when the plan was started'),
});

// Store for active execution plans (in-memory for now, could be persisted)
const activePlans = new Map<string, Plan>();

/**
 * Finds the next dependent task that is in progress but not yet finished.
 * Returns the first task that depends on the given task and is still running.
 */
function findNextDependentTask(plan: Plan, completedTaskId: string): Task | undefined {
  const tasks = Array.from(plan.tasks.values());
  return find(tasks, (task) => task.dependsOn?.includes(completedTaskId) && task.status === 'running');
}

/**
 * executePlan tool
 *
 * This tool takes a user query and uses the routing agent to analyze it,
 * determine which agents/tools need to be called, and in what order.
 * It fires off the execution in a fire-and-forget fashion and returns
 * immediately with a confirmation that the task has been started.
 */
export const executePlan = createTool({
  id: 'executePlan',
  description: `Execute a plan based on a user query. This tool analyzes the query, determines which agents and tools need to be called and in what order (as a DAG), and starts executing them asynchronously. It returns immediately with a plan ID and the list of tasks that will be executed.

Use this tool when you need to:
- Execute a complex query that requires multiple agent/tool calls
- Handle queries where some operations can run in parallel while others depend on previous results
- Get immediate confirmation that a task has started while the actual work happens in the background

The tool will:
1. Analyze the query to determine required agents/tools
2. Create a DAG (Directed Acyclic Graph) of tasks with dependencies
3. Start executing tasks asynchronously (fire-and-forget)
4. Return the execution plan with run IDs for each task

You can then use getPlanResult to check on the status and results of individual tasks.`,
  inputSchema: z.object({
    query: z.string().describe('The full user query to be executed'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    plan: executionPlanSchema.optional(),
    message: z.string(),
  }),
  execute: async (inputData, context) => {
    const { query } = inputData;
    const planId = uniqueId('plan-');

    try {
      if (!context?.mastra) {
        return {
          success: false,
          message: 'Mastra instance not available in context',
        };
      }

      // Get the routing agent to analyze the query
      let routingAgent;
      try {
        routingAgent = context.mastra.getAgent('RoutingAgent');
      } catch {
        return {
          success: false,
          message: 'Routing agent not found. Please ensure the routing vertical is properly configured.',
        };
      }

      // Use the routing agent to analyze and execute the query
      // Using generate() with increased maxSteps to ensure all tool calls complete
      const resultPromise = routingAgent.generate(query, { maxSteps: 10 });

      // Create a plan entry to track this execution
      const plan: Plan = {
        planId,
        query,
        tasks: new Map<string, Task>(),
        startedAt: new Date().toISOString(),
      };

      // Create a single task to track the execution
      const mainTaskId = uniqueId('task-');
      const mainTask: Task = {
        runId: mainTaskId,
        description: truncate(`Execute query: ${query}`, { length: 100 }),
        status: 'running',
        dependsOn: [],
        result: undefined,
        error: undefined,
        promise: undefined,
      };

      // Process the result asynchronously (fire-and-forget)
      mainTask.promise = (async () => {
        try {
          const result = await resultPromise;
          mainTask.status = 'completed';
          mainTask.result = result;
          return result;
        } catch (error) {
          mainTask.status = 'failed';
          mainTask.error = error instanceof Error ? error.message : String(error);
          throw error;
        }
      })();

      plan.tasks.set(mainTaskId, mainTask);
      activePlans.set(planId, plan);

      // Return immediately with the plan
      return {
        success: true,
        plan: {
          planId,
          query,
          tasks: [
            {
              runId: mainTaskId,
              description: mainTask.description,
              status: mainTask.status,
              dependsOn: mainTask.dependsOn,
            },
          ],
          startedAt: plan.startedAt,
        },
        message: `Plan ${planId} started successfully. Use getPlanResult with runId "${mainTaskId}" to check the result.`,
      };
    } catch (error) {
      console.error('❌ Failed to execute plan:', error);
      return {
        success: false,
        message: `Failed to execute plan: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});

/**
 * getPlanResult tool
 *
 * This tool retrieves the result of a specific task from an execution plan.
 * It waits synchronously for the task to complete and returns the result.
 * When a task completes, it also returns the ID of the next dependent task (if any).
 */
export const getPlanResult = createTool({
  id: 'getPlanResult',
  description: `Get the result of a specific task from an execution plan. This tool waits for the task to complete (if it hasn't already) and returns the result along with the next dependent task ID if available.

Use this tool when you need to:
- Check if a task has completed
- Get the result of a completed task
- Wait for a specific task to finish before proceeding
- Get the next task ID to check after this one completes

The tool will:
1. Find the task by its run ID
2. Wait for the task to complete if it's still running
3. Return the result or error message
4. Return the next dependent task ID (first in-progress task that depends on this one)`,
  inputSchema: z.object({
    runId: z.string().describe('The run ID of the task to retrieve the result for'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    status: z.enum(['pending', 'running', 'completed', 'failed']).optional(),
    result: z.unknown().optional(),
    error: z.string().optional(),
    nextTaskId: z.string().optional().describe('The run ID of the next dependent task that is in progress'),
    message: z.string(),
  }),
  execute: async (inputData) => {
    const { runId } = inputData;

    try {
      // Find the plan containing this run ID
      let foundTask: Task | undefined;
      let foundPlan: Plan | undefined;

      for (const [, plan] of activePlans) {
        const task = plan.tasks.get(runId);
        if (task) {
          foundTask = task;
          foundPlan = plan;
          break;
        }
      }

      if (!foundTask || !foundPlan) {
        return {
          success: false,
          message: `Task with runId "${runId}" not found. Make sure the runId is correct and the plan is still active.`,
        };
      }

      // If the task is still running, wait for it to complete
      if (foundTask.status === 'running' && foundTask.promise) {
        try {
          await foundTask.promise;
        } catch {
          // Error is already captured in the task
        }
      }

      // Find the next dependent task that is in progress
      const nextTask = findNextDependentTask(foundPlan, runId);
      const nextTaskId = nextTask?.runId;

      // Return the result with nextTaskId
      if (foundTask.status === 'completed') {
        return {
          success: true,
          status: foundTask.status,
          result: foundTask.result,
          nextTaskId,
          message: nextTaskId
            ? `Task completed successfully. Next task in progress: ${nextTaskId}`
            : `Task completed successfully.`,
        };
      } else if (foundTask.status === 'failed') {
        return {
          success: false,
          status: foundTask.status,
          error: foundTask.error,
          nextTaskId,
          message: `Task failed: ${foundTask.error}`,
        };
      } else {
        return {
          success: true,
          status: foundTask.status,
          nextTaskId,
          message: `Task is still ${foundTask.status}.`,
        };
      }
    } catch (error) {
      console.error('❌ Failed to get plan result:', error);
      return {
        success: false,
        message: `Failed to get plan result: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});

export const routingTools = {
  executePlan,
  getPlanResult,
};
