import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';
import { startContainer, ContainerStartupResult } from './helpers/container-startup';

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

  test('should start both Mastra and MCP servers successfully', async () => {
    console.log('Checking that both servers started without errors...');
    
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
    
    // Check that both servers started without errors
    expect(stdout).not.toContain('ERROR: MCP server failed to start or exited immediately');
    expect(stdout).not.toContain('ERROR: Mastra server failed to start or exited immediately');
    
    // Verify Mastra server is accessible via nginx on port 5690
    let mastraAccessible = false;
    try {
      const response = await fetch('http://localhost:5690/');
      if (response.status < 500) {
        mastraAccessible = true;
        console.log(`Mastra server is accessible with status: ${response.status}`);
      }
    } catch (error) {
      console.log(`Mastra server check error: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    expect(mastraAccessible, 'Mastra server should be accessible via nginx').toBe(true);
  });
});
