#!/usr/bin/env node

import { MCPServer } from '@mastra/mcp';
import express from 'express';
import { logTokenUsageSummary, mastra } from './index.js';
import { initializeScheduler } from './scheduler.js';
import { createInstructionsWorkflowTool, createSimplifiedWorkflowTool } from './utils/mcp-tool-factory.js';
import { MCP_PATH, readsItsOwnBody } from './verticals/api/routes.js';
import { getMissingClaudeCodeHostVariables, isClaudeCodeHostConfigured } from './verticals/coding/index.js';
import {
  attachLiveSocket,
  getPublicAgents,
  LIVE_SOCKET_PATH,
  registerApiRoutes,
  registerArtifactRoutes,
  registerLiveSignInPage,
  registerShoppingTriggers,
  startHomeAssistantEventMonitor,
  whyPhotoSlotsAreOff,
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
    },
  });

  console.log('Starting J.A.R.V.I.S. MCP Server...');

  const port = parseInt(process.env.PORT || '4112', 10);
  const host = process.env.HOST || '0.0.0.0';

  const app = express();

  // JSON body parsing middleware for API routes. Not for the routes that read their own body — the
  // MCP endpoint, and the photo routes, which are open to anyone — however the path is spelled: see
  // `readsItsOwnBody` in `verticals/api/routes.ts`, whose spec mounts this same check.
  const parseJson = express.json();
  app.use((req, res, next) => {
    if (readsItsOwnBody(req.path)) {
      next();
    } else {
      parseJson(req, res, next);
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

  // The pages the visualize vertical builds, hosted for a day under the tunnel's public hostname
  const artifactRoutePath = registerArtifactRoutes(apiRouter);

  // The page a browser opens to sign in to the server through Cloudflare Access, which the headset
  // needs: it cannot send a token on its socket, so it rides on Access's cookie instead
  const liveSignInPath = registerLiveSignInPage(apiRouter);
  app.use(apiRouter);

  // MCP endpoint - handles both GET (for initial connection) and POST (for messages)
  app.all(MCP_PATH, (req, res): void => {
    const base = `http://${host}:${port}`;
    const url = new URL(req.url || '', base);

    void (async () => {
      try {
        await mcpServer.startHTTP({
          url,
          httpPath: MCP_PATH,
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

  console.log(`J.A.R.V.I.S. MCP Server listening on http://${host}:${port}${MCP_PATH}`);
  for (const { method, path } of registeredApiRoutes) {
    console.log(`API endpoint available: ${method} http://${host}:${port}${path}`);
  }
  console.log(`Hosted pages available: GET http://${host}:${port}${artifactRoutePath}`);
  console.log(`Sign-in page available: GET http://${host}:${port}${liveSignInPath}`);

  // Register email triggers for shopping notifications
  registerShoppingTriggers();

  // The Claude Code secrets are optional (mcp/op.optional.env), so say once why coding sessions will not start
  if (!isClaudeCodeHostConfigured()) {
    console.warn(
      `⚠️ Claude Code sessions are not configured. Missing: ${getMissingClaudeCodeHostVariables().join(', ')}. Coding sessions will not start.`,
    );
  }

  // A photo slot is opened only for a conversation ElevenLabs confirms is live on Jarvis's agent, so
  // without the ElevenLabs key or an agent id no photo is taken in: say so once, naming the missing
  // variables — never a value
  const photoUploadsOffBecause = whyPhotoSlotsAreOff();
  if (photoUploadsOffBecause) {
    console.warn(`⚠️ ${photoUploadsOffBecause}`);
  }

  // Log token usage summary on startup
  await logTokenUsageSummary();

  // Reconcile the persisted workflow schedules and start the workers that fire them
  await initializeScheduler();

  // Report what happens in the house as it happens, over Home Assistant's websocket API. Only
  // this process does it, for the same reason only this process owns the schedules: Studio
  // builds the same instance, and two monitors would file every change twice.
  await startHomeAssistantEventMonitor(mastra);

  // Start the Express server, and the WebSocket API on the same port: the phone, the watch and the
  // headset each keep a socket open on it for as long as a conversation lasts (see
  // `verticals/api/live-socket.ts`)
  return new Promise<void>((resolve) => {
    const server = app.listen(port, host, () => {
      console.log(`Server running on http://${host}:${port}`);
      console.log(`MCP HTTP endpoint: http://${host}:${port}${MCP_PATH}`);
      console.log(`WebSocket API available: ws://${host}:${port}${LIVE_SOCKET_PATH}`);
      resolve();
    });
    attachLiveSocket(server);
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
