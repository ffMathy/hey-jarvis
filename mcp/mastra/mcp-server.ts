#!/usr/bin/env node

import type { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { MCPServer } from '@mastra/mcp';
import express from 'express';
import { expressjwt } from 'express-jwt';
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
  // JWT authentication is mandatory - validate BEFORE loading any agents or modules
  const jwtSecret = process.env.HEY_JARVIS_MCP_JWT_SECRET;
  if (!jwtSecret) {
    throw new Error(
      'HEY_JARVIS_MCP_JWT_SECRET environment variable is required for security. ' +
      'The MCP server cannot run without JWT authentication.'
    );
  }

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

  const app = express();

  console.log('JWT authentication enabled for MCP endpoint');

  // Apply JWT middleware and MCP handler in a single chained call
  app.use(
    httpPath,
    expressjwt({
      secret: jwtSecret,
      algorithms: ['HS256'],
      credentialsRequired: true,
    }),
    (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      // Error handler for JWT failures
      if (err.name === 'UnauthorizedError') {
        res.status(401).json({
          error: 'Invalid or missing authentication token',
          message: err.message,
        });
        return;
      }
      next(err);
    },
    async (req, res) => {
      // MCP handler - only reached if JWT is valid
      await mcpServer.startHTTP({
        url: new URL(req.url || '', `http://${host}:${port}`),
        httpPath,
        req,
        res,
      });
    }
  );

  // Global error handler for other errors
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled error:', err);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal server error',
        message: err.message,
      });
    }
  });

  const server = app.listen(port, host, () => {
    console.log(`J.A.R.V.I.S. MCP Server listening on http://${host}:${port}${httpPath}`);
  });

  return server;
}

// Only auto-start if this file is run directly (not imported)
if (import.meta.main) {
  startMcpServer().catch((error) => {
    console.error('Failed to start servers:', error);
    process.exit(1);
  });
}
