import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { generateTestToken, generateExpiredToken } from './helpers/jwt-helper';

const sleep = promisify(setTimeout);

/**
 * Start a container with JWT authentication enabled
 */
async function startContainerWithJWT(jwtSecret: string): Promise<{ containerId: string; cleanup: () => Promise<void> }> {
  console.log('Building Docker image for JWT testing...');
  
  // Build the Docker image
  await new Promise<void>((resolve, reject) => {
    const buildProc = spawn('docker', ['build', '-t', 'home-assistant-addon-jwt-test', '--target', 'home-assistant-addon-end-to-end-test', '.'], {
      cwd: '/home/runner/work/hey-jarvis/hey-jarvis/home-assistant-addon',
      stdio: 'inherit'
    });
    
    buildProc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Docker build failed with code ${code}`));
      }
    });
  });
  
  console.log('Starting container with JWT authentication...');
  
  // Start the container with JWT_SECRET environment variable
  const containerId = await new Promise<string>((resolve, reject) => {
    const runProc = spawn('docker', [
      'run',
      '-d',
      '--rm',
      '--name', 'home-assistant-addon-jwt-test',
      '-p', '5690:5690',
      '-e', `JWT_SECRET=${jwtSecret}`,
      '-e', 'HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY=test-key',
      'home-assistant-addon-jwt-test'
    ], {
      stdio: 'pipe'
    });
    
    let output = '';
    runProc.stdout?.on('data', (data) => {
      output += data.toString();
    });
    
    runProc.on('close', (code) => {
      if (code === 0) {
        resolve(output.trim());
      } else {
        reject(new Error(`Docker run failed with code ${code}`));
      }
    });
  });
  
  console.log(`Container started with ID: ${containerId}`);
  
  // Wait for servers to start
  console.log('Waiting for servers to initialize...');
  await sleep(15000);
  
  const cleanup = async () => {
    console.log('Stopping container...');
    await new Promise<void>((resolve) => {
      const stopProc = spawn('docker', ['stop', 'home-assistant-addon-jwt-test'], {
        stdio: 'inherit'
      });
      stopProc.on('close', () => resolve());
    });
  };
  
  return { containerId, cleanup };
}

test.describe('JWT Authentication Tests', () => {
  const JWT_SECRET = 'test-secret-for-jwt-authentication-minimum-32-chars';
  let container: { containerId: string; cleanup: () => Promise<void> } | undefined;

  test.beforeAll(async () => {
    container = await startContainerWithJWT(JWT_SECRET);
  });

  test.afterAll(async () => {
    if (container) {
      await container.cleanup();
    }
  });

  test('should allow access to Mastra UI without JWT token', async () => {
    // Mastra UI should be accessible without JWT - it's protected by Home Assistant ingress
    const response = await fetch('http://localhost:5690/', {
      method: 'GET',
    });

    expect(response.status).toBeLessThan(500);
    expect(response.status).not.toBe(401);
    console.log(`✓ Mastra UI accessible without JWT token (status: ${response.status})`);
  });

  test('should deny access to MCP server without JWT token', async () => {
    const response = await fetch('http://localhost:5690/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1
      })
    });

    expect(response.status).toBe(401);
    console.log('✓ MCP server access denied without JWT token');
  });

  test('should deny MCP server access with invalid JWT token', async () => {
    const response = await fetch('http://localhost:5690/api/mcp', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer invalid-token-here',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1
      })
    });

    expect(response.status).toBe(401);
    console.log('✓ MCP server access denied with invalid JWT token');
  });

  test('should deny MCP server access with expired JWT token', async () => {
    const expiredToken = await generateExpiredToken(JWT_SECRET);
    
    const response = await fetch('http://localhost:5690/api/mcp', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${expiredToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1
      })
    });

    expect(response.status).toBe(401);
    console.log('✓ MCP server access denied with expired JWT token');
  });

  test('should allow MCP server access with valid JWT token', async () => {
    const validToken = await generateTestToken(JWT_SECRET);
    
    const response = await fetch('http://localhost:5690/api/mcp', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${validToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1
      })
    });

    // We expect either success or a method-specific error, but NOT 401
    expect(response.status).not.toBe(401);
    console.log(`✓ MCP server access granted with valid JWT token (status: ${response.status})`);
  });

  test('should accept JWT token in Bearer format (case-insensitive)', async () => {
    const validToken = await generateTestToken(JWT_SECRET);
    
    // Test with lowercase 'bearer'
    const response = await fetch('http://localhost:5690/api/mcp', {
      method: 'POST',
      headers: {
        'Authorization': `bearer ${validToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1
      })
    });

    expect(response.status).not.toBe(401);
    console.log('✓ Bearer scheme is case-insensitive for MCP server');
  });

  test('should not require JWT for Mastra UI even when configured', async () => {
    // Double-check that Mastra UI remains accessible without JWT
    const response = await fetch('http://localhost:5690/agents', {
      method: 'GET',
    });

    expect(response.status).not.toBe(401);
    console.log(`✓ Mastra UI /agents endpoint accessible without JWT (status: ${response.status})`);
  });
});

test.describe('JWT Authentication Disabled Tests', () => {
  test.skip('should allow access without JWT when authentication is disabled', async () => {
    // This test would require starting a container without JWT_SECRET
    // For now, we skip it as the default configuration in tests has JWT disabled
    // The graceful degradation is tested by the regular server startup tests
  });
});
