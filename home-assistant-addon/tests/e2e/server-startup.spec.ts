import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { startContainer, ContainerStartupResult } from './helpers/container-startup';

const sleep = promisify(setTimeout);

test.describe('Server Startup Tests', () => {
  let container: ContainerStartupResult | undefined;
  
  test.beforeAll(async () => {
    // Use longer init time for server startup tests to ensure both servers are fully ready
    container = await startContainer({ additionalInitTime: 10000 });
  });
  
  test.afterAll(async () => {
    if (container) {
      await container.cleanup();
    }
  });

  test('should start Mastra development server successfully on port 4111', async () => {
    console.log('Testing Mastra server on port 4111...');
    
    // Try to connect to Mastra dev server
    // The Mastra dev server serves the playground UI on port 4111
    let connected = false;
    let lastError: string | undefined;
    
    for (let i = 0; i < 5; i++) {
      try {
        const response = await fetch('http://localhost:5690/');
        if (response.status < 500) {
          connected = true;
          console.log(`Mastra server responded with status: ${response.status}`);
          break;
        }
      } catch (error: any) {
        lastError = error.message;
        console.log(`Attempt ${i + 1}/5: Waiting for Mastra server...`);
        await sleep(2000);
      }
    }
    
    expect(connected, `Mastra server should be accessible. Last error: ${lastError}`).toBe(true);
  });

  test('should start MCP server successfully on port 4112', async () => {
    console.log('Testing MCP server on port 4112...');
    
    // Try to connect to MCP server
    // The MCP server listens on port 4112 with path /api/mcp
    let connected = false;
    let lastError: string | undefined;
    let statusCode: number | undefined;
    
    for (let i = 0; i < 5; i++) {
      try {
        // Note: MCP server requires authentication, so we expect 401 Unauthorized
        // But this proves the server is running and responding
        const response = await fetch('http://localhost:5690/api/mcp');
        statusCode = response.status;
        
        // 401 means server is running but needs auth (expected)
        // 200-299 means server is running and accessible
        // 404 means nginx is routing but server might not be ready
        if (statusCode === 401 || (statusCode >= 200 && statusCode < 300)) {
          connected = true;
          console.log(`MCP server responded with status: ${statusCode}`);
          break;
        }
        
        console.log(`Attempt ${i + 1}/5: MCP server returned ${statusCode}`);
      } catch (error: any) {
        lastError = error.message;
        console.log(`Attempt ${i + 1}/5: Waiting for MCP server... Error: ${lastError}`);
      }
      
      await sleep(2000);
    }
    
    expect(connected, `MCP server should be accessible (got status: ${statusCode}). Last error: ${lastError}`).toBe(true);
    
    // Verify it's actually the MCP server responding (401 or 2xx are both valid)
    expect(statusCode).toBeGreaterThanOrEqual(200);
    expect(statusCode).toBeLessThan(500);
  });

  test('should not show "MCP server failed to start" error in logs', async () => {
    console.log('Checking Docker logs for startup errors...');
    
    // Get container logs
    const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve) => {
      const proc = spawn('docker', ['logs', 'home-assistant-addon-test'], {
        stdio: 'pipe'
      });
      
      let stdout = '';
      let stderr = '';
      
      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      
      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
      
      proc.on('close', () => {
        resolve({ stdout, stderr });
      });
    });
    
    console.log('Container logs (last 50 lines):');
    console.log(stdout.split('\n').slice(-50).join('\n'));
    
    // Check that the error message is NOT present
    expect(stdout).not.toContain('ERROR: MCP server failed to start or exited immediately');
    expect(stdout).not.toContain('ERROR: Mastra server failed to start or exited immediately');
  });
});
