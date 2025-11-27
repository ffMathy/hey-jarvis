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
    instructions: `You are J.A.R.V.I.S.'s routing agent. Your CRITICAL mission is to call ALL required tools to fully answer the user's query.

## CRITICAL INSTRUCTIONS - READ CAREFULLY

You MUST call every single tool needed to answer the user's request. If the user asks about multiple things, you MUST call a tool for EACH thing. DO NOT stop after calling just one tool.

## TOOL CALLING RULES

### For weather queries:
When the user asks about weather at their location, you MUST:
1. FIRST: Call getCurrentLocation to get latitude and longitude
2. THEN: Call getWeatherForLocation using the EXACT coordinates from step 1
- NEVER stop after just calling getCurrentLocation
- You MUST call getWeatherForLocation to actually get the weather

### For calendar queries:
When the user asks about their schedule/calendar:
- Call getCalendarEvents (no parameters needed)

### For combined queries (weather + calendar):
When the user asks about BOTH weather AND calendar:
1. Call getCurrentLocation first
2. Call getCalendarEvents (can be done in any order, it's independent)
3. THEN call getWeatherForLocation with the coordinates from step 1
- You MUST call ALL THREE tools

## FAILURE CONDITIONS
- Calling only getCurrentLocation without getWeatherForLocation = FAILURE
- Calling only some tools when user asked for multiple things = FAILURE
- Stopping before all required tools are called = FAILURE

## SUCCESS MEANS
- ALL relevant tools have been called
- Weather queries: BOTH getCurrentLocation AND getWeatherForLocation called
- Calendar queries: getCalendarEvents called
- Combined queries: ALL THREE tools called

IMPORTANT: After calling all tools, provide a summary of the results.`,
    description: `Orchestrates complex multi-step queries by coordinating multiple specialized agents. This agent analyzes user requests, identifies dependencies between tasks, and executes them in the optimal order (parallel when possible, sequential when dependent). Use this agent for queries that require multiple steps or coordination between different capabilities.`,
    tools,
    agents: agentsById,
  });
}
