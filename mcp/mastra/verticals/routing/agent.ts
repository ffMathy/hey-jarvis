import type { Agent } from '@mastra/core/agent';
import { createAgent } from '../../utils/index.js';
import { getPublicAgents } from '../index.js';
import { routingTools } from './tools.js';

/**
 * Routing Agent
 *
 * This agent acts as the orchestrator for complex multi-step queries.
 * It uses Mastra's Agent Network capability to analyze user queries,
 * determine which agents and tools need to be called, and coordinate
 * their execution in the correct order based on dependencies.
 *
 * The routing agent has access to all public agents and can delegate
 * tasks to them as needed. It uses the executePlan and getPlanResult
 * tools to provide fire-and-forget execution with result retrieval.
 */
export async function getRoutingAgent(): Promise<Agent> {
  // Get all public agents to make them available for the network
  const publicAgents = await getPublicAgents();

  // Build agents object dynamically using agent IDs
  const agentsById = publicAgents.reduce(
    (acc, agent) => {
      const agentId = agent.id;
      acc[agentId] = agent;
      return acc;
    },
    {} as Record<string, (typeof publicAgents)[0]>,
  );

  return createAgent({
    name: 'RoutingAgent',
    instructions: `You are J.A.R.V.I.S.'s routing agent, responsible for orchestrating complex multi-step queries.

Your primary role is to analyze user requests and coordinate the execution of tasks across multiple specialized agents.

## Available Specialized Agents
You have access to the following agents that you can delegate tasks to:
${publicAgents.map((a) => `- **${a.name}**: ${a.getDescription()}`).join('\n')}

## Your Capabilities
1. **Query Analysis**: Break down complex user queries into discrete tasks
2. **Dependency Detection**: Identify which tasks depend on results from other tasks
3. **Parallel Execution**: Execute independent tasks simultaneously for efficiency
4. **Result Aggregation**: Combine results from multiple agents into a coherent response

## Execution Strategy
When receiving a complex query:
1. Identify all the individual tasks that need to be completed
2. Determine dependencies between tasks (e.g., getting weather requires knowing the location first)
3. Execute independent tasks in parallel
4. Wait for dependent tasks to complete before starting tasks that need their results
5. Aggregate and present the final results

## Examples
For a query like "Check the weather for my current location, check my calendar, and introduce yourself":
- Task 1: Introduce yourself (no dependencies, execute immediately)
- Task 2: Check calendar (no dependencies, execute immediately in parallel with Task 1)
- Task 3: Get current location (no dependencies, execute immediately in parallel)
- Task 4: Get weather for location (depends on Task 3, execute after Task 3 completes)

## Guidelines
- Always optimize for parallelism when tasks are independent
- Provide clear feedback about what tasks are being executed
- Handle failures gracefully and continue with remaining tasks if possible
- Be efficient - don't make unnecessary agent calls`,
    description: `Orchestrates complex multi-step queries by coordinating multiple specialized agents. This agent analyzes user requests, identifies dependencies between tasks, and executes them in the optimal order (parallel when possible, sequential when dependent). Use this agent for queries that require multiple steps or coordination between different capabilities.`,
    tools: routingTools,
    agents: agentsById,
  });
}
