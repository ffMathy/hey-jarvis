/**
 * Server entry point for the Mastra application.
 * This file starts the Hono server and initializes the Mastra instance.
 */

import app, { logTokenUsageSummary, mastra } from './index.js';

const port = Number.parseInt(process.env.MASTRA_SERVER_PORT || '4111', 10);
const host = process.env.HOST || '0.0.0.0';

// Log token usage statistics on startup
await logTokenUsageSummary();

console.log(`🚀 Starting Mastra server on ${host}:${port}...`);

// Start the Bun server with the Hono app
Bun.serve({
  port,
  hostname: host,
  fetch: app.fetch,
});

console.log(`✅ Mastra server running at http://${host}:${port}`);
console.log(`📊 OpenAPI docs: http://${host}:${port}/openapi.json`);
console.log(`🏥 Health check: http://${host}:${port}/health`);
