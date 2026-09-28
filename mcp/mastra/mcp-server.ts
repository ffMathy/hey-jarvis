#!/usr/bin/env node

import { MCPServer } from '@mastra/mcp';
import express from 'express';
import { logTokenUsageSummary } from './index.js';
import { initializeScheduler } from './scheduler.js';
import { createInstructionsWorkflowTool, createSimplifiedWorkflowTool } from './utils/mcp-tool-factory.js';
import { getMissingClaudeCodeHostVariables, isClaudeCodeHostConfigured } from './verticals/coding/index.js';
import {
  getPublicAgents,
  PHOTO_UPLOAD_PATH,
  preparePhotoUpload,
  registerApiRoutes,
  registerShoppingTriggers,
  withoutUploadToken,
} from './verticals/index.js';
import { getNextInstructionsWorkflow, routePromptWorkflow } from './verticals/routing/workflows.js';

// Re-export for cross-project imports
export { getPublicAgents };

export async function startMcpServer() {
  const mcpServer = new MCPServer({
    id: 'jarvis-mcp-server',
    name: 'J.A.R.V.I.S. Assistant',
    version: '1.0.0',
    agents: {},
    tools: {
      routePromptWorkflow: createInstructionsWorkflowTool(routePromptWorkflow),
      getNextInstructionsWorkflow: createSimplifiedWorkflowTool(getNextInstructionsWorkflow),
      // Here rather than on the Mastra instance: the upload URL is built from the MCP request's own
      // host, and the slot lives in this process, beside the photo route. See `vision/tools.ts`.
      preparePhotoUpload,
    },
  });

  console.log('Starting J.A.R.V.I.S. MCP Server...');

  const port = parseInt(process.env.PORT || '4112', 10);
  const host = process.env.HOST || '0.0.0.0';
  const mcpPath = '/api/mcp';

  const app = express();

  // JSON body parsing middleware for API routes. Not the MCP endpoint and its subpaths, which read
  // the raw body, and not the photo route, which is open to anyone and must turn a stranger away
  // before reading anything they send (see `claimSlotBeforeReading` in `verticals/api/routes.ts`).
  app.use((req, res, next) => {
    if (req.path === mcpPath || req.path.startsWith(`${mcpPath}/`) || req.path.startsWith(`${PHOTO_UPLOAD_PATH}/`)) {
      next();
    } else {
      express.json()(req, res, next);
    }
  });

  // Request logging middleware
  app.use((req, res, next) => {
    const startTime = Date.now();
    const requestTimestamp = new Date().toISOString();

    // Log incoming request, without the key to an upload slot in it
    const loggedUrl = withoutUploadToken(req.url);
    console.log(`[${requestTimestamp}] ${req.method} ${loggedUrl}`);

    // Log response when finished
    res.on('finish', () => {
      const responseTimestamp = new Date().toISOString();
      const duration = Date.now() - startTime;
      console.log(`[${responseTimestamp}] ${req.method} ${loggedUrl} - ${res.statusCode} (${duration}ms)`);
    });

    next();
  });

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy' });
  });

  // Create a router for API routes
  const apiRouter = express.Router();

  // Register API routes (shopping list, etc.) and get the registered paths
  const registeredApiRoutes = registerApiRoutes(apiRouter);
  app.use(apiRouter);

  // MCP endpoint - handles both GET (for initial connection) and POST (for messages)
  app.all(mcpPath, (req, res): void => {
    const base = `http://${host}:${port}`;
    const url = new URL(req.url || '', base);

    void (async () => {
      try {
        await mcpServer.startHTTP({
          url,
          httpPath: mcpPath,
          req,
          res,
        });
      } catch (err: unknown) {
        console.error('Error handling MCP HTTP connection', err);
        if (!res.headersSent) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          res.status(500).json({
            error: 'Failed to establish MCP connection',
            details: errorMessage,
          });
        }
      }
    })();
  });

  // Express error handler
  app.use(
    (err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(err.status || 500).json({
        error: 'Internal server error',
        message: err.message,
      });
    },
  );

  console.log(`J.A.R.V.I.S. MCP Server listening on http://${host}:${port}${mcpPath}`);
  for (const { method, path } of registeredApiRoutes) {
    console.log(`API endpoint available: ${method} http://${host}:${port}${path}`);
  }

  // Register email triggers for shopping notifications
  registerShoppingTriggers();

  // The Claude Code secrets are optional (mcp/op.optional.env), so say once why coding sessions will not start
  if (!isClaudeCodeHostConfigured()) {
    console.warn(
      `⚠️ Claude Code sessions are not configured. Missing: ${getMissingClaudeCodeHostVariables().join(', ')}. Coding sessions will not start.`,
    );
  }

  // Log token usage summary on startup
  await logTokenUsageSummary();

  // Reconcile the persisted workflow schedules and start the workers that fire them
  await initializeScheduler();

  // Start the Express server
  return new Promise<void>((resolve) => {
    app.listen(port, host, () => {
      console.log(`Server running on http://${host}:${port}`);
      console.log(`MCP HTTP endpoint: http://${host}:${port}${mcpPath}`);
      resolve();
    });
  });
}

void (async () => {
  try {
    await startMcpServer();
  } catch (error) {
    console.error('Failed to start servers:', error);
    process.exit(1);
  }
})();
