import { type ChildProcess, spawn } from 'child_process';
import { promisify } from 'util';
import { getMastraUIUrl, getMCPServerUrl } from './ports';

const sleep = promisify(setTimeout);

export interface ContainerStartupResult {
  dockerProcess: ChildProcess;
  cleanup: () => Promise<void>;
}

export interface ContainerStartupOptions {
  maxWaitTime?: number;
  checkInterval?: number;
  additionalInitTime?: number;
  environmentVariables?: Record<string, string>;
}

/**
 * Starts the Docker container using the start-addon.sh script and waits for it to be ready.
 * Returns the docker process and a cleanup function.
 */
export async function startContainer(options: ContainerStartupOptions = {}): Promise<ContainerStartupResult> {
  const {
    maxWaitTime = 60 * 1000 * 5, // 5 minutes default
    checkInterval = 2000, // 2 seconds default
    additionalInitTime = 5000, // 5 seconds default
    environmentVariables = {},
  } = options;

  const startTime = Date.now();
  console.log('Starting Docker container using start-addon.sh...');

  // Forward all process.env variables and merge with any additional ones
  const env = { ...process.env, ...environmentVariables };

  // Start the Docker container using start-addon.sh script
  const dockerProcess = spawn('bash', ['./home-assistant-addon/tests/start-addon.sh'], {
    stdio: 'inherit',
    detached: false,
    env,
  });

  // Wait for the container to be ready
  console.log('Waiting for container to start...');

  let waitTime = 0;
  let mcpOrMastraReady = false;

  while (waitTime < maxWaitTime) {
    try {
      const response = await fetch(getMCPServerUrl());
      if (response.status < 500) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`MCP server is ready! (took ${elapsed}s)`);
        mcpOrMastraReady = true;
        break;
      }
    } catch {
      // Container not ready yet
    }

    try {
      const response = await fetch(getMastraUIUrl());
      if (response.status < 500) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`Mastra UI is ready! (took ${elapsed}s)`);
        mcpOrMastraReady = true;
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

    throw new Error(`Container failed to start within timeout period (${elapsed}s elapsed)`);
  }

  // Wait for nginx ingress proxy to be ready (separate check)
  if (mcpOrMastraReady) {
    console.log('Waiting for nginx ingress proxy to be ready...');
    const ingressStartTime = Date.now();
    let ingressWaitTime = 0;
    const ingressMaxWaitTime = 30000; // 30 seconds max for nginx to start

    while (ingressWaitTime < ingressMaxWaitTime) {
      try {
        // Check if the ingress path is working by making a request
        const response = await fetch('http://localhost:5000/api/hassio_ingress/redacted/');
        if (response.status < 500) {
          const elapsed = ((Date.now() - ingressStartTime) / 1000).toFixed(1);
          console.log(`Nginx ingress proxy is ready! (took ${elapsed}s)`);
          break;
        }
      } catch {
        // Ingress not ready yet
      }

      await sleep(checkInterval);
      ingressWaitTime += checkInterval;
    }

    if (ingressWaitTime >= ingressMaxWaitTime) {
      console.warn('Nginx ingress proxy did not respond within timeout, continuing anyway...');
    }
  }

  // Give it additional time to fully initialize
  await sleep(additionalInitTime);

  // Create cleanup function
  const cleanup = async () => {
    console.log('Cleaning up Docker container...');

    if (dockerProcess && dockerProcess.pid) {
      // Kill the process group to ensure cleanup
      try {
        process.kill(dockerProcess.pid, 'SIGTERM');
      } catch (error) {
        console.log('Error killing Docker process:', error);
      }
    }

    // Also run docker cleanup commands
    try {
      const cleanupProcess = spawn('docker', ['stop', 'home-assistant-addon-test'], {
        stdio: 'inherit',
      });
      await new Promise<void>((resolve) => {
        cleanupProcess.on('close', () => {
          console.log('Docker container stopped');
          resolve();
        });
      });
    } catch (error) {
      console.log('Docker cleanup error:', error);
    }

    await sleep(5000); // Wait for cleanup
  };

  return {
    dockerProcess,
    cleanup,
  };
}
