#!/usr/bin/env node

import type { Workflow } from '@mastra/core/workflows';
import { MCPServer } from '@mastra/mcp';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import { expressjwt } from 'express-jwt';
import { z } from 'zod';
import { initializeScheduler } from './scheduler.js';
import { createTool } from './utils/tool-factory.js';
import { getPublicAgents, registerApiRoutes } from './verticals/index.js';
import { getNextInstructionsWorkflow, routePromptWorkflow } from './verticals/routing/workflows.js';

// Re-export for cross-project imports
export { getPublicAgents };

function createSimplifiedWorkflowTool<TWorkflow extends Workflow>(workflow: TWorkflow) {
  const workflowName = workflow.name ?? workflow.id;
  return createTool({
    id: workflowName,
    description: workflow.description ?? '',
    inputSchema: workflow.inputSchema ?? z.object({}),
    outputSchema: workflow.outputSchema ?? z.unknown(),
    execute: async (context) => {
      console.log(`Executing workflow tool: ${workflowName}`);

      const run = await workflow.createRun();
      const result = await run.start({
        inputData: context,
      });
      if (result.status !== 'success') {
        const errorMessage =
          'error' in result && result.error instanceof Error
            ? result.error.message
            : `Workflow failed with status ${result.status}`;
        throw new Error(`Workflow ${workflowName} failed: ${errorMessage}`);
      }

      return result.result;
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
    tools: {
      routePromptWorkflow: createSimplifiedWorkflowTool(routePromptWorkflow),
      getNextInstructionsWorkflow: createSimplifiedWorkflowTool(getNextInstructionsWorkflow),
    },
  });

  console.log('Starting J.A.R.V.I.S. MCP Server...');

  const port = parseInt(process.env.PORT || '4112', 10);
  const host = process.env.HOST || '0.0.0.0';
  const mcpPath = '/api/mcp';

  const app = express();

  // JSON body parsing middleware for API routes (exclude MCP endpoint which reads raw body)
  app.use((req, res, next) => {
    if (req.path === mcpPath) {
      next();
    } else {
      express.json()(req, res, next);
    }
  });

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

  // Create a router for JWT-protected API routes
  const apiRouter = express.Router();
  apiRouter.use(
    expressjwt({
      secret: jwtSecret,
      algorithms: ['HS256'],
      credentialsRequired: true,
    }),
  );

  // Register API routes (shopping list, etc.) and get the registered paths
  const registeredApiPaths = registerApiRoutes(apiRouter);
  app.use(apiRouter);

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
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          res.status(500).json({
            error: 'Failed to establish MCP connection',
            details: errorMessage,
          });
        }
      }
    },
  );

  // Express error handler for JWT authentication failures
  app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
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
  for (const apiPath of registeredApiPaths) {
    console.log(`API endpoint available: POST http://${host}:${port}${apiPath}`);
  }

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
