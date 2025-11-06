#!/usr/bin/env node

/**
 * Manual Test Script for JWT Authentication
 * 
 * This script tests the JWT authentication on the MCP server
 * by making requests with and without valid tokens.
 * 
 * Prerequisites:
 * 1. Start the MCP server: npx nx serve:mcp mcp
 * 2. Ensure HEY_JARVIS_MCP_JWT_SECRET is set
 * 
 * Usage:
 *   npx tsx mcp/mastra/utils/test-jwt-auth.ts
 */

import { sign } from 'hono/jwt';

const MCP_SERVER_URL = 'http://localhost:4112/api/mcp';

async function testAuthentication() {
  console.log('🧪 Testing JWT Authentication on MCP Server\n');
  console.log(`Target: ${MCP_SERVER_URL}\n`);

  const jwtSecret = process.env.HEY_JARVIS_MCP_JWT_SECRET;
  
  if (!jwtSecret) {
    console.log('⚠️  Warning: HEY_JARVIS_MCP_JWT_SECRET not set.');
    console.log('    Authentication tests will show the no-auth behavior.\n');
  }

  // Test 1: Request without token
  console.log('Test 1: Request without Authorization header');
  console.log('Expected: 401 Unauthorized (if JWT secret configured)');
  try {
    const response = await fetch(MCP_SERVER_URL);
    console.log(`✓ Status: ${response.status} ${response.statusText}`);
    if (response.status === 401) {
      const body = await response.text();
      console.log(`  Response: ${body}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`✗ Error: ${message}`);
  }
  console.log('');

  // Test 2: Request with invalid token
  console.log('Test 2: Request with invalid token');
  console.log('Expected: 401 Unauthorized');
  try {
    const response = await fetch(MCP_SERVER_URL, {
      headers: {
        'Authorization': 'Bearer invalid.token.here'
      }
    });
    console.log(`✓ Status: ${response.status} ${response.statusText}`);
    if (response.status === 401) {
      const body = await response.text();
      console.log(`  Response: ${body}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`✗ Error: ${message}`);
  }
  console.log('');

  // Test 3: Request with valid token (if JWT secret available)
  if (jwtSecret) {
    console.log('Test 3: Request with valid JWT token');
    console.log('Expected: 200 OK or other valid MCP response');
    try {
      const payload = {
        sub: 'test-client',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
      };
      const token = await sign(payload, jwtSecret);
      
      const response = await fetch(MCP_SERVER_URL, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      console.log(`✓ Status: ${response.status} ${response.statusText}`);
      if (response.status !== 401) {
        console.log(`  ✓ Authentication successful! MCP server accessible.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`✗ Error: ${message}`);
    }
  } else {
    console.log('Test 3: Skipped (no JWT secret configured)');
  }
  console.log('');

  console.log('📊 Test Summary:');
  console.log('  - Requests without tokens should be rejected (401)');
  console.log('  - Requests with invalid tokens should be rejected (401)');
  console.log('  - Requests with valid tokens should succeed');
  console.log('');
  console.log('Note: If JWT secret is not configured, all requests will succeed.');
}

testAuthentication().catch(console.error);
