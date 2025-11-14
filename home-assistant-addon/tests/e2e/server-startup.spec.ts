import { test, expect } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
const sleep = promisify(setTimeout);

test.describe('Server Startup Tests', () => {
  let dockerProcess: ChildProcess | null = null;
  
  test.beforeAll(async () => {
    const startTime = Date.now();
    console.log('Starting Docker container for server startup tests...');
    
    // Track if the startup script exits early (indicates failure)
    let scriptExited = false;
    
    // Start the Docker container using start-addon.sh script
    dockerProcess = spawn('bash', ['./home-assistant-addon/tests/start-addon.sh'], {
      stdio: 'pipe',
      detached: true
    });
    
    let dockerOutput = '';
    let dockerErrors = '';
    
    dockerProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      dockerOutput += output;
      console.log('Docker stdout:', output);
    });
    
    dockerProcess.stderr?.on('data', (data) => {
      const output = data.toString();
      dockerErrors += output;
      console.log('Docker stderr:', output);
    });
    
    // Check if the process exits prematurely
    let exitCode: number | null = null;
    dockerProcess.on('exit', (code) => {
      scriptExited = true;
      exitCode = code;
      console.error(`Docker startup script exited with code ${code}`);
    });
    
    // Wait for the container to be ready
    console.log('Waiting for container to start...');

    // Wait up to 2 minutes for the container to be ready (long enough for both servers)
    const maxWaitTime = 60 * 1000 * 2; // 2 minutes
    const checkInterval = 2000; // 2 seconds
    let waitTime = 0;
    
    while (waitTime < maxWaitTime) {
      // Check if startup script exited (indicates failure)
      if (scriptExited) {
        console.error('Docker process exited prematurely!');
        console.error('Exit code:', exitCode);
        console.error('Last output:', dockerOutput);
        console.error('Last errors:', dockerErrors);
        throw new Error(`Docker startup script exited with code ${exitCode} before container was ready - check logs above for details`);
      }
      
      try {
        const response = await fetch('http://localhost:5690/');
        if (response.status < 500) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`Container is ready! (took ${elapsed}s)`);
          break;
        }
      } catch {
        // Container not ready yet
      }
      
      await sleep(checkInterval);
      waitTime += checkInterval;
      
      // Log progress every 30 seconds
      if (waitTime % 30000 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`Still waiting for container... (${elapsed}s elapsed)`);
      }
    }
    
    if (waitTime >= maxWaitTime) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.error('Container startup timeout!');
      console.error('Last output:', dockerOutput);
      console.error('Last errors:', dockerErrors);
      throw new Error(`Container failed to start within timeout period (${elapsed}s elapsed)`);
    }
    
    // Give servers additional time to fully initialize
    await sleep(10000); // 10 seconds
  });
  
  test.afterAll(async () => {
    console.log('Cleaning up Docker container...');
    
    if (dockerProcess && dockerProcess.pid) {
      // Kill the process group to ensure cleanup
      try {
        process.kill(-dockerProcess.pid, 'SIGTERM');
      } catch (error) {
        console.log('Error killing Docker process:', error);
      }
    }
    
    // Also run docker cleanup commands
    try {
      const cleanup = spawn('docker', ['stop', 'home-assistant-addon-test'], { stdio: 'inherit' });
      cleanup.on('close', () => {
        console.log('Docker container stopped');
      });
    } catch (error) {
      console.log('Docker cleanup error:', error);
    }
    
    await sleep(5000); // Wait for cleanup
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
