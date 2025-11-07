import { test, expect } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
const sleep = promisify(setTimeout);

test.describe('Docker Container Integration Tests', () => {
  let dockerProcess: ChildProcess | null = null;
  
  test.beforeAll(async () => {
    const startTime = Date.now();
    console.log('Starting Docker container using start-addon.sh...');
    
    // Start the Docker container using start-addon.sh script
    dockerProcess = spawn('bash', ['./home-assistant-addon/tests/start-addon.sh'], {
      stdio: 'pipe',
      detached: true
    });
    
    dockerProcess.stdout?.on('data', (data) => {
      console.log('Docker stdout:', data.toString());
    });
    
    dockerProcess.stderr?.on('data', (data) => {
      console.log('Docker stderr:', data.toString());
    });
    
    // Wait for the container to be ready
    console.log('Waiting for container to start...');

    // Wait up to 5 minutes for the container to be ready
    // (Image is pre-built during 'build' step, so startup should be faster)
    const maxWaitTime = 60 * 1000 * 5; // 5 minutes
    const checkInterval = 2000; // 2 seconds (frequent checks for faster detection)
    let waitTime = 0;
    
    while (waitTime < maxWaitTime) {
      try {
        const response = await fetch('http://localhost:5000/api/hassio_ingress/redacted/');
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
      throw new Error(`Container failed to start within timeout period (${elapsed}s elapsed)`);
    }
    
    // Give it a bit more time to fully initialize
    await sleep(5000); // Reduced from 10s to 5s
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

  test('should load main application without network failures', async ({ page }) => {
    const networkRequests: Array<{ url: string; status: number; method: string }> = [];
    const failedRequests: Array<{ url: string; status: number; error?: string }> = [];

    // Monitor all network requests
    page.on('response', (response) => {
      const request = {
        url: response.url(),
        status: response.status(),
        method: response.request().method(),
      };
      
      networkRequests.push(request);
      
      if (response.status() >= 400) {
        failedRequests.push({
          url: response.url(),
          status: response.status(),
        });
      }
    });

    page.on('requestfailed', (request) => {
      failedRequests.push({
        url: request.url(),
        status: 0,
        error: request.failure()?.errorText || 'Request failed',
      });
    });

    // Navigate to the application
    await page.goto('http://localhost:5000/api/hassio_ingress/redacted/');
    
    // Wait for the DOM to be ready (don't wait for networkidle since SSE connections stay open)
    await page.waitForLoadState('domcontentloaded');
    
    // Wait a bit for any additional resources to load
    await page.waitForTimeout(5000);
    
    // Log results
    console.log(`Total requests: ${networkRequests.length}`);
    console.log(`Failed requests: ${failedRequests.length}`);
    
    if (failedRequests.length > 0) {
      console.log('Failed requests:', failedRequests);
    }
    
    // Assert no critical failures (500+ errors)
    const criticalFailures = failedRequests.filter(req => req.status >= 500);
    expect(criticalFailures).toHaveLength(0);
    
    // Assert no failed asset loads (404s for JS, CSS, images)
    // Exclude SSE endpoints which may fail/retry
    const assetFailures = failedRequests.filter(req => 
      req.status === 404 && 
      (req.url.includes('/assets/') || req.url.endsWith('.js') || req.url.endsWith('.css') || req.url.endsWith('.svg'))
    );
    expect(assetFailures).toHaveLength(0);
    
    // Assert the page loaded
    expect(page.url()).toContain('localhost:5000');
  });
});
