#!/usr/bin/env node

import type { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { MCPServer } from '@mastra/mcp';
import express from 'express';
import { expressjwt } from 'express-jwt';
import { z } from 'zod';
import { initializeScheduler } from './scheduler.js';
import { getCalendarAgent } from './verticals/calendar/index.js';
import { getCodingAgent } from './verticals/coding/index.js';
import { getEmailAgent } from './verticals/email/index.js';
import { getHomeAssistantAgent } from './verticals/home-assistant/index.js';
import { getShoppingListAgent } from './verticals/shopping/index.js';
import { getTodoListAgent } from './verticals/todo-list/index.js';
import { getWeatherAgent } from './verticals/weather/index.js';

export async function getPublicAgents(): Promise<Record<string, Agent>> {
  const [coding, weather, shopping, email, calendar, todoList, homeAssistant] = await Promise.all([
    getCodingAgent(),
    getWeatherAgent(),
    getShoppingListAgent(),
    getEmailAgent(),
    getCalendarAgent(),
    getTodoListAgent(),
    getHomeAssistantAgent(),
  ]);

  return {
    coding,
    weather,
    shopping,
    email,
    calendar,
    todoList,
    homeAssistant,
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
      } catch (error) {
        const err = error as Error & { details?: { message?: string } };
        return { response: err.message || err.details?.message || 'An error occurred' };
      }
    },
  });
}

export async function startMcpServer() {
  const jwtSecret = process.env.HEY_JARVIS_MCP_JWT_SECRET;

  if (!jwtSecret) {
    throw new Error(
      'HEY_JARVIS_MCP_JWT_SECRET environment variable is required. ' +
        'JWT authentication cannot be disabled for security reasons.',
    );
  }

  const agents = await getPublicAgents();

  // Create simplified tools that return clean text responses
  const tools = {
    ask_weather: createSimplifiedAgentTool(
      'weather',
      agents.weather,
      'Get weather information for a location. Ask about current conditions or forecasts.',
    ),
    ask_shopping: createSimplifiedAgentTool(
      'shopping',
      agents.shopping,
      'Manage shopping lists and find products at Bilka online store.',
    ),
    ask_coding: createSimplifiedAgentTool(
      'coding',
      agents.coding,
      'Get help with GitHub repositories, issues, and coding tasks.',
    ),
    ask_email: createSimplifiedAgentTool(
      'email',
      agents.email,
      'Search emails, create drafts, reply to messages, and manage your Microsoft Outlook inbox.',
    ),
    ask_calendar: createSimplifiedAgentTool(
      'calendar',
      agents.calendar,
      'Manage Google Calendar events. Create, update, delete, or search calendar events.',
    ),
    ask_todoList: createSimplifiedAgentTool(
      'todoList',
      agents.todoList,
      'Manage Google Tasks to-do lists. Create, update, delete, or retrieve tasks from your task lists.',
    ),
    ask_homeAssistant: createSimplifiedAgentTool(
      'homeAssistant',
      agents.homeAssistant,
      'Control and monitor Home Assistant smart home devices. Turn devices on/off, adjust settings, query device states, and view historical changes.',
    ),
  };

  const mcpServer = new MCPServer({
    name: 'J.A.R.V.I.S. Assistant',
    version: '1.0.0',
    agents: {},
    tools,
  });

  console.log('Starting J.A.R.V.I.S. MCP Server...');

  const port = parseInt(process.env.PORT || '4112', 10);
  const host = process.env.HOST || '0.0.0.0';
  const mcpPath = '/api/mcp';

  const app = express();

  // Health check endpoint (no JWT required)
  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy', version: '1.0.0' });
  });

  // MCP endpoint - handles both GET (for initial connection) and POST (for messages)
  app.all(
    mcpPath,
    expressjwt({
      secret: jwtSecret,
      algorithms: ['HS256'],
      credentialsRequired: true,
    }),
    async (req, res) => {
      try {
        const base = `http://${host}:${port}`;
        const url = new URL(req.url || '', base);

        await mcpServer.startHTTP({
          url,
          httpPath: mcpPath,
          req,
          res,
        });

        // startHTTP takes over the response (including SSE/streaming)
        // so we don't send anything else here
      } catch (err) {
        console.error('Error handling MCP HTTP connection', err);
        if (!res.headersSent) {
          res.status(500).json({
            error: 'Failed to establish MCP connection',
            details: (err as Error).message,
          });
        }
      }
    },
  );

  // Express error handler for JWT authentication failures
  app.use((err: Error & { status?: number }, req, res, _next) => {
    if (err.name === 'UnauthorizedError') {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or missing JWT token',
      });
    } else {
      res.status(err.status || 500).json({
        error: 'Internal server error',
        message: err.message,
      });
    }
  });

  console.log(`JWT authentication enabled for ${mcpPath} with secret length: ${jwtSecret.length} characters`);
  console.log(`J.A.R.V.I.S. MCP Server listening on http://${host}:${port}${mcpPath}`);

  // Initialize and start workflow scheduler
  const scheduler = initializeScheduler();
  scheduler.start();

  // Start the Express server
  return new Promise<void>((resolve) => {
    app.listen(port, host, () => {
      console.log(`Server running on http://${host}:${port}`);
      console.log(`MCP HTTP endpoint: http://${host}:${port}${mcpPath}`);
      resolve();
    });
  });
}

// Only auto-start if this file is run directly (not imported)
if (import.meta.main) {
  startMcpServer().catch((error) => {
    console.error('Failed to start servers:', error);
    process.exit(1);
  });
}
