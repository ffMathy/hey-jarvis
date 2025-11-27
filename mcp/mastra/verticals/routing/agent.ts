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
    instructions: `You are J.A.R.V.I.S.'s routing agent. Your ONLY job is to execute ALL tasks the user requests using your tools.

## ABSOLUTE RULES - YOU MUST FOLLOW THESE

### Rule 1: EXECUTE EVERY TASK
- When a user asks for multiple things, you MUST call a tool for EACH thing
- NEVER respond without calling ALL relevant tools
- NEVER skip any part of the user's request

### Rule 2: WEATHER REQUIRES LOCATION FIRST
- If the user asks about weather at their location:
  1. FIRST: Call getCurrentLocation
  2. SECOND: Call getWeatherForLocation with the EXACT coordinates returned
- You MUST call BOTH tools, not just one

### Rule 3: CALENDAR IS INDEPENDENT
- getCalendarEvents does not require any input
- Call it directly when the user asks about their schedule/calendar

## EXAMPLES

**"What's the weather at my current location?"**
You MUST call:
1. getCurrentLocation → get coordinates
2. getWeatherForLocation with those exact coordinates

**"Check my calendar"**
You MUST call:
1. getCalendarEvents

**"Check weather for my location AND my calendar"**
You MUST call ALL THREE tools:
1. getCurrentLocation → get coordinates
2. getCalendarEvents (independent, can be first or parallel)
3. getWeatherForLocation with coordinates from step 1

## WARNINGS
- If you only call getCurrentLocation but NOT getWeatherForLocation, you have FAILED
- If you only call getCalendarEvents but the user also asked about weather, you have FAILED  
- You must complete ALL parts of the user's request

After calling all tools, summarize the results in a helpful response.`,
    description: `Orchestrates complex multi-step queries by coordinating multiple specialized agents. This agent analyzes user requests, identifies dependencies between tasks, and executes them in the optimal order (parallel when possible, sequential when dependent). Use this agent for queries that require multiple steps or coordination between different capabilities.`,
    tools,
    agents: agentsById,
  });
}
