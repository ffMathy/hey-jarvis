#!/usr/bin/env node

import { MCPServer } from '@mastra/mcp';
import { weatherAgent, weatherTools } from './verticals/weather';
import { shoppingListAgent, shoppingTools } from './verticals/shopping';

async function main() {
  const mcpServer = new MCPServer({
    name: "J.A.R.V.I.S. Assistant",
    version: "1.0.0",
    description: "A comprehensive assistant that provides weather information and shopping list management via MCP",
    agents: { 
      weather: weatherAgent,
      shopping: shoppingListAgent
    },
    tools: {}
  });

  console.log('Starting J.A.R.V.I.S. MCP Server...');
  console.log('Available weather tools:', Object.keys(weatherTools));
  console.log('Available shopping tools:', Object.keys(shoppingTools));
  
  await mcpServer.startStdio();
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.error('Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});