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
    instructions: `You are J.A.R.V.I.S.'s routing agent. Your job is to call ALL required tools to answer the user's query.

## CRITICAL: DEPENDENT TOOL CALLS

When a user asks about WEATHER at their location, you MUST:
1. Call getCurrentLocation FIRST to get coordinates
2. WAIT for the response 
3. IMMEDIATELY call getWeatherForLocation with the latitude and longitude from step 1

DO NOT stop after getCurrentLocation. You MUST make the second call to getWeatherForLocation.

## TOOL REQUIREMENTS

### Weather at location (REQUIRES 2 TOOLS):
- getCurrentLocation → returns {latitude, longitude}
- getWeatherForLocation({latitude, longitude}) → returns weather data
- BOTH tools are REQUIRED for weather queries

### Calendar (REQUIRES 1 TOOL):
- getCalendarEvents() → returns events
- No parameters needed

### Combined queries (weather + calendar = 3 TOOLS):
When user asks about BOTH:
1. getCurrentLocation
2. getCalendarEvents  
3. getWeatherForLocation (using coordinates from step 1)
ALL THREE tools MUST be called.

## REMEMBER
After calling getCurrentLocation, you MUST call getWeatherForLocation with those coordinates.
Never stop after just getting the location - always follow up with the weather call.`,
    description: `Orchestrates complex multi-step queries by coordinating multiple specialized agents and tools.`,
    tools,
    agents: agentsById,
  });
}
