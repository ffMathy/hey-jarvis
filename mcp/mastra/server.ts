import { serve } from '@hono/node-server';
import type { Mastra } from '@mastra/core';
import { Hono } from 'hono';
import { mastra } from './index.js';
import { startMcpServer } from './mcp-server.js';

async function startMastraServer(mastra: Mastra) {
  // Create Hono app and mount Mastra middleware
  const app = new Hono();

  // Get and mount Mastra server middleware
  const middlewares = mastra.getServerMiddleware();
  for (const middleware of middlewares) {
    app.use(middleware.path, async (c, next) => {
      const result = await middleware.handler(c, next);
      if (result instanceof Response) {
        return result;
      }
    });
  }

  // Start the server
  const port = parseInt(process.env.PORT || '4111', 10);
  const host = process.env.HOST || '0.0.0.0';

  console.log(`Starting Mastra server on ${host}:${port}...`);

  serve({
    fetch: app.fetch,
    port,
    hostname: host,
  });

  console.log(`Mastra server running at http://${host}:${port}`);
}

const startServersPromise = Promise.all([
  startMastraServer(mastra),
  startMcpServer()
]);
startServersPromise.catch((error) => {
  console.error('Failed to start servers:', error);
  process.exit(1);
});