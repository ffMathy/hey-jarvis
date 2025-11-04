#!/usr/bin/env node

import { MCPServer } from '@mastra/mcp';
import { createServer } from 'node:http';
import { publicAgents } from './shared';

async function main() {
  const mcpServer = new MCPServer({
    name: "J.A.R.V.I.S. Assistant",
    version: "1.0.0",
    description: "A comprehensive assistant that provides weather information and shopping list management via MCP",
    agents: publicAgents,
    tools: {}
  });

  console.log('Starting J.A.R.V.I.S. MCP Server...');

  const port = parseInt(process.env.PORT || '4111', 10);
  const host = process.env.HOST || '0.0.0.0';
  const httpPath = '/api/mcp';

  const httpServer = createServer(async (req, res) => {
    await mcpServer.startHTTP({
      url: new URL(req.url || '', `http://${host}:${port}`),
      httpPath,
      req,
      res,
    });
  });

  httpServer.listen(port, host, () => {
    console.log(`J.A.R.V.I.S. MCP Server listening on http://${host}:${port}${httpPath}`);
  });

  // Store server instance for graceful shutdown
  return httpServer;
}

// Handle graceful shutdown
let serverInstance: ReturnType<typeof createServer> | null = null;

process.on('SIGINT', () => {
  console.error('Received SIGINT, shutting down gracefully...');
  if (serverInstance) {
    serverInstance.close(() => {
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

process.on('SIGTERM', () => {
  console.error('Received SIGTERM, shutting down gracefully...');
  if (serverInstance) {
    serverInstance.close(() => {
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

main().then((server) => {
  serverInstance = server;
}).catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});