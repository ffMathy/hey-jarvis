#!/usr/bin/env node

import type { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { MCPServer } from '@mastra/mcp';
import { createServer } from 'node:http';
import { z } from 'zod';
import { getCodingAgent } from './verticals/coding/index.js';
import { getShoppingListAgent } from './verticals/shopping/index.js';
import { getWeatherAgent } from './verticals/weather/index.js';

export async function getPublicAgents(): Promise<Record<string, Agent>> {
  const [coding, weather, shopping] = await Promise.all([getCodingAgent(), getWeatherAgent(), getShoppingListAgent()]);

  return {
    coding,
    weather,
    shopping,
  };
}

/**
 * Creates a simplified tool that wraps an agent and returns clean text responses
 * without verbose error metadata
 */
function createSimplifiedAgentTool(name: string, agent: Agent, description: string) {
  return createTool({
    id: `ask_${name}`,
    description,
    inputSchema: z.object({
      message: z.string().describe('The question or request to send to the agent'),
    }),
    outputSchema: z.object({
      response: z.string().describe('The agent response text'),
    }),
    execute: async (input) => {
      try {
        const result = await agent.generate(input.message);
        return { response: result.text || 'No response generated' };
      } catch (error: any) {
        // Return simplified error message
        return { response: error.message || error.details?.message || 'An error occurred' };
      }
    },
  });
}

export async function startMcpServer() {
  const agents = await getPublicAgents();

  // Create simplified tools that return clean text responses
  const tools = {
    ask_weather: createSimplifiedAgentTool(
      'weather',
      agents.weather,
      'Get weather information for a location. Ask about current conditions or forecasts.'
    ),
    ask_shopping: createSimplifiedAgentTool(
      'shopping',
      agents.shopping,
      'Manage shopping lists and find products at Bilka online store.'
    ),
    ask_coding: createSimplifiedAgentTool(
      'coding',
      agents.coding,
      'Get help with GitHub repositories, issues, and coding tasks.'
    ),
  };

  const mcpServer = new MCPServer({
    name: 'J.A.R.V.I.S. Assistant',
    version: '1.0.0',
    description:
      'A comprehensive assistant that provides weather information, shopping list management, and GitHub repository coding assistance via MCP',
    agents: {}, // Don't expose agents directly to avoid automatic tool creation
    tools,
  });

  console.log('Starting J.A.R.V.I.S. MCP Server...');

  const port = parseInt(process.env.PORT || '4112', 10);
  const host = process.env.HOST || '0.0.0.0';
  const httpPath = '/api/mcp';

  const httpServer = createServer(async (req, res) => {
    await mcpServer.startHTTP({
      url: new URL(req.url || '', `http://${host}:${port}`),
      httpPath,
      req,
      res,
    });
  });

  httpServer.listen(port, host, () => {
    console.log(`J.A.R.V.I.S. MCP Server listening on http://${host}:${port}${httpPath}`);
  });

  return httpServer;
}

startMcpServer().catch((error) => {
  console.error('Failed to start servers:', error);
  process.exit(1);
});
