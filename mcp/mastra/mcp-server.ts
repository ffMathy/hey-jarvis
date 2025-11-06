#!/usr/bin/env node

import { MCPServer } from '@mastra/mcp';
import { createServer } from 'node:http';
import { shoppingListAgent } from './verticals/shopping/index.js';
import { weatherAgent } from './verticals/weather/index.js';
import { validateJwtToken, sendUnauthorizedResponse } from './utils/jwt-auth.js';

export const publicAgents = {
  weather: weatherAgent,
  shopping: shoppingListAgent
};

export async function startMcpServer() {
  const mcpServer = new MCPServer({
    name: "J.A.R.V.I.S. Assistant",
    version: "1.0.0",
    description: "A comprehensive assistant that provides weather information and shopping list management via MCP",
    agents: publicAgents,
    tools: {}
  });

  console.log('Starting J.A.R.V.I.S. MCP Server...');

  const port = 4112;
  const host = process.env.HOST || '0.0.0.0';
  const httpPath = '/api/mcp';

  const httpServer = createServer(async (req, res) => {
    // Validate JWT token for authentication
    const isAuthenticated = await validateJwtToken(req);
    
    if (!isAuthenticated) {
      sendUnauthorizedResponse(res);
      return;
    }

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

startMcpServer().catch((error) => {
  console.error('Failed to start servers:', error);
  process.exit(1);
});