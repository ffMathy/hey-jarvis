#!/usr/bin/env node

import type { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { MCPServer } from '@mastra/mcp';
import express from 'express';
import { expressjwt } from 'express-jwt';
import { z } from 'zod';
import { initializeScheduler } from './scheduler.js';
import { getPublicAgents, routePromptWorkflow } from './verticals/index.js';

/**
 * Creates a simplified tool that wraps an agent and returns clean text responses
 * without verbose error metadata
 */
function createSimplifiedAgentTool(agent: Agent) {
  return createTool({
    id: `ask_${agent.name}`,
    description: agent.getDescription(),
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

  const mcpServer = new MCPServer({
    name: 'J.A.R.V.I.S. Assistant',
    version: '1.0.0',
    agents: {},
    workflows: {
      routePromptWorkflow
    },
    tools: {}
  });

  console.log('Starting J.A.R.V.I.S. MCP Server...');

  const port = parseInt(process.env.PORT || '4112', 10);
  const host = process.env.HOST || '0.0.0.0';
  const mcpPath = '/api/mcp';

  const app = express();

  // Request logging middleware
  app.use((req, res, next) => {
    const startTime = Date.now();
    const requestTimestamp = new Date().toISOString();

    // Log incoming request
    console.log(`[${requestTimestamp}] ${req.method} ${req.url}`);

    // Log response when finished
    res.on('finish', () => {
      const responseTimestamp = new Date().toISOString();
      const duration = Date.now() - startTime;
      console.log(`[${responseTimestamp}] ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
    });

    next();
  });

  // Health check endpoint (no JWT required)
  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy' });
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
  app.use((err: Error & { status?: number }, _req, res, _next) => {
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

startMcpServer().catch((error) => {
  console.error('Failed to start servers:', error);
  process.exit(1);
});
