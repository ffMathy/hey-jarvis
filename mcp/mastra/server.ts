// Prevent auto-initialization when importing index.js
process.env.SKIP_AUTO_INIT = 'true';

import { MastraServer } from '@mastra/hono';
import { Hono } from 'hono';
import { BODY_LIMIT_OPTIONS, logTokenUsageSummary, mastra } from './index.js';

// Initialize server
(async () => {
  // Log token usage on startup
  await logTokenUsageSummary();

  // Create Hono app
  const app = new Hono();

  // Initialize Mastra Server
  const mastraServer = new MastraServer({
    app: app,
    mastra: mastra,
    openapiPath: '/openapi.json',
    bodyLimitOptions: BODY_LIMIT_OPTIONS,
    streamOptions: { redact: true },
  });

  // Initialize routes (including health check)
  await mastraServer.init();

  // Start the Bun server
  const port = Number.parseInt(process.env.MASTRA_SERVER_PORT || '4111', 10);
  const host = process.env.HOST || '0.0.0.0';

  console.log(`🚀 Mastra server starting on ${host}:${port}`);

  Bun.serve({
    fetch: app.fetch,
    port,
    hostname: host,
  });
})();
