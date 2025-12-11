// Prevent auto-initialization when importing index.js
process.env.SKIP_AUTO_INIT = 'true';

import { MastraServer } from '@mastra/hono';
import { Hono } from 'hono';
import { logTokenUsageSummary, mastra } from './index.js';

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
    bodyLimitOptions: {
      maxSize: 10 * 1024 * 1024, // 10MB
      onError: (_err) => ({ error: 'Payload too large', maxSize: '10MB' }),
    },
    streamOptions: { redact: true },
  });

  // Initialize routes
  await mastraServer.init();

  // Add health check
  app.get('/health', (c) => c.json({ status: 'ok', runtime: 'bun' }));

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
