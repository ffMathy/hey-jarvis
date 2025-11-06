#!/usr/bin/env node

/**
 * JWT Token Generator Utility
 * 
 * This script generates a JWT token for testing the MCP server authentication.
 * 
 * Usage:
 *   npx tsx mcp/mastra/utils/generate-jwt.ts
 * 
 * The token will be valid for 24 hours and includes a basic payload.
 */

import { sign } from 'hono/jwt';

async function generateToken() {
  const jwtSecret = process.env.HEY_JARVIS_MCP_JWT_SECRET;
  
  if (!jwtSecret) {
    console.error('Error: HEY_JARVIS_MCP_JWT_SECRET environment variable is not set.');
    console.error('Please set it before generating tokens.');
    process.exit(1);
  }

  const payload = {
    sub: 'mcp-client',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours from now
  };

  try {
    const token = await sign(payload, jwtSecret);
    
    console.log('\n✅ JWT Token Generated Successfully!\n');
    console.log('Token:');
    console.log(token);
    console.log('\nUse this token in the Authorization header:');
    console.log(`Authorization: Bearer ${token}`);
    console.log('\nThis token is valid for 24 hours.');
    console.log('\nExample curl command:');
    console.log(`curl -H "Authorization: Bearer ${token}" http://localhost:4112/api/mcp`);
    console.log('');
  } catch (error) {
    console.error('Error generating token:', error);
    process.exit(1);
  }
}

generateToken();
