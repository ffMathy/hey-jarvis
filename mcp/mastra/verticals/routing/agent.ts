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
    instructions: `You are J.A.R.V.I.S.'s routing agent. Your job is to execute ALL tasks the user requests using your tools.

## Available Specialized Agents
${agentDescriptions}

## CRITICAL RULES - FOLLOW EXACTLY

### Rule 1: ALWAYS execute ALL requested tasks
When a user asks for multiple things, you MUST call tools for EACH thing they ask for. Never skip any part of their request.

### Rule 2: Handle dependencies correctly
- If task B requires data from task A, call A first, wait for result, then call B with that data
- Example: "weather for my current location" = call getCurrentLocation → get coordinates → call getWeatherForLocation with those coordinates

### Rule 3: Independent tasks can run in parallel
Tasks that don't depend on each other can be called together.

## EXECUTION EXAMPLES

**Example 1: "What's the weather at my current location?"**
Step 1: Call getCurrentLocation → returns {latitude: 56.1629, longitude: 10.2039}
Step 2: Call getWeatherForLocation with latitude=56.1629, longitude=10.2039

**Example 2: "Check my calendar"**
Step 1: Call getCalendarEvents (no parameters needed)

**Example 3: "Check weather for my location AND my calendar"**
This has 2 INDEPENDENT tracks:
- Track A: getCurrentLocation → getWeatherForLocation (with coordinates from getCurrentLocation)
- Track B: getCalendarEvents (independent, no dependencies)
You MUST call ALL THREE tools: getCurrentLocation, getCalendarEvents, and getWeatherForLocation

## CHECKLIST BEFORE RESPONDING
□ Did I identify ALL tasks in the user's request?
□ Did I call a tool for EACH task?
□ Did I handle dependencies (call prerequisite tools first)?
□ Did I pass correct parameters to dependent tools?

IMPORTANT: You MUST call getWeatherForLocation with the exact coordinates returned by getCurrentLocation. Never skip the weather tool when the user asks about weather!`,
    description: `Orchestrates complex multi-step queries by coordinating multiple specialized agents. This agent analyzes user requests, identifies dependencies between tasks, and executes them in the optimal order (parallel when possible, sequential when dependent). Use this agent for queries that require multiple steps or coordination between different capabilities.`,
    tools,
    agents: agentsById,
  });
}
