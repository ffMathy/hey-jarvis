import type { Agent } from '@mastra/core/agent';
import type { Tool } from '@mastra/core/tools';
import { keyBy } from 'lodash-es';
import { createAgent } from '../../utils/index.js';
import { getPublicAgents } from '../index.js';
import { routingTools } from './tools.js';

/**
 * Routing Agent Configuration Options
 */
export interface RoutingAgentOptions {
  /**
   * Override the default tools with custom tools (useful for testing)
   */
  tools?: Record<string, Tool>;
  /**
   * Override the default agents with custom agents (useful for testing, can be set to empty object)
   */
  agents?: Record<string, Agent>;
}

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
export async function getRoutingAgent(options: RoutingAgentOptions = {}): Promise<Agent> {
  // Get all public agents to make them available for the network (unless overridden)
  const publicAgents = options.agents !== undefined ? [] : await getPublicAgents();

  // Build agents object dynamically using agent IDs, or use provided agents
  const agentsById = options.agents ?? keyBy(publicAgents, 'id');

  // Use provided tools or default routing tools
  const tools = options.tools ?? routingTools;

  // Build agent descriptions for the prompt
  const agentDescriptions =
    publicAgents.length > 0
      ? publicAgents.map((a) => `- **${a.name}**: ${a.getDescription()}`).join('\n')
      : 'No specialized agents available. Use your tools directly.';

  return createAgent({
    name: 'RoutingAgent',
    instructions: `You are J.A.R.V.I.S.'s routing agent, responsible for orchestrating complex multi-step queries.

Your primary role is to analyze user requests and coordinate the execution of tasks using your available tools.

## Available Specialized Agents
${agentDescriptions}

## Your Capabilities
1. **Query Analysis**: Break down complex user queries into discrete tasks
2. **Dependency Detection**: Identify which tasks depend on results from other tasks
3. **Sequential Execution for Dependencies**: Call dependent tools AFTER their prerequisites complete
4. **Result Aggregation**: Combine results from multiple agents into a coherent response

## CRITICAL: Tool Calling Rules
1. You MUST call ALL tools that are relevant to the user's query
2. For DEPENDENT tools (like weather needing location): 
   - FIRST call the prerequisite tool (getCurrentLocation)
   - WAIT for the result
   - THEN call the dependent tool (getWeatherForLocation) with the result
3. For INDEPENDENT tools (like getCalendarEvents): call them immediately
4. DO NOT stop after calling some tools - continue until ALL tasks are complete

## Execution Flow Example
For "Check weather for my current location and check my calendar":
1. Call getCurrentLocation (returns latitude: 56.1629, longitude: 10.2039)
2. Call getCalendarEvents (independent, can be parallel)
3. THEN call getWeatherForLocation with the coordinates from step 1
4. Combine all results and respond

IMPORTANT: You MUST call getWeatherForLocation AFTER getCurrentLocation returns coordinates. Do not skip the weather tool!

## Guidelines
- Complete ALL parts of the user's request
- For weather queries: ALWAYS call location first, THEN weather with those coordinates
- Handle failures gracefully but continue with remaining tasks
- Provide comprehensive results for all requested information`,
    description: `Orchestrates complex multi-step queries by coordinating multiple specialized agents. This agent analyzes user requests, identifies dependencies between tasks, and executes them in the optimal order (parallel when possible, sequential when dependent). Use this agent for queries that require multiple steps or coordination between different capabilities.`,
    tools,
    agents: agentsById,
  });
}
