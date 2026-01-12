import { type ChildProcess, spawn } from 'child_process';
import { promisify } from 'util';
import { getContainerIP } from './docker-helper';
import { PORTS } from './ports';

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
 * Check if a server is ready by making a health check request
 */
async function isServerReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.status < 500;
  } catch {
    return false;
  }
}

/**
 * Wait for MCP server and Mastra dev (which serves both API and Studio on same port) to be ready
 */
async function waitForServers(startTime: number, maxWaitTime: number, checkInterval: number): Promise<void> {
  let waitTime = 0;
  const readyStatus = { mcp: false, mastra: false };

  // Get container IP for Docker network access (required in Docker-in-Docker/devcontainer)
  const containerIP = await getContainerIP();
  const mcpUrl = `http://${containerIP}:${PORTS.MCP_SERVER}`;
  const mastraUrl = `http://${containerIP}:${PORTS.MASTRA_SERVER}`; // Same as MASTRA_STUDIO (both 4111)

  console.log(`Accessing servers via Docker bridge network IP: ${containerIP}`);
  console.log(`  MCP server: ${mcpUrl}`);
  console.log(`  Mastra dev (API + Studio): ${mastraUrl}`);

  while (waitTime < maxWaitTime) {
    if (!readyStatus.mcp && (await isServerReady(mcpUrl))) {
      readyStatus.mcp = true;
      console.log(`MCP server is ready! (took ${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
    }

    if (!readyStatus.mastra && (await isServerReady(mastraUrl))) {
      readyStatus.mastra = true;
      console.log(`Mastra dev is ready! (took ${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
    }

    if (readyStatus.mcp && readyStatus.mastra) {
      return;
    }

    await sleep(checkInterval);
    waitTime += checkInterval;

    if (waitTime % 30000 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`Still waiting... (${elapsed}s) - MCP: ${readyStatus.mcp}, Mastra: ${readyStatus.mastra}`);
    }
  }

  throw new Error(`Container failed to start within timeout (${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
}

/**
 * Wait for nginx ingress proxy to be ready
 */
async function waitForIngressProxy(checkInterval: number): Promise<void> {
  console.log('Waiting for nginx ingress proxy to be ready...');
  const ingressStartTime = Date.now();
  let ingressWaitTime = 0;
  const ingressMaxWaitTime = 30000;

  const containerIP = await getContainerIP();
  const ingressUrl = `http://${containerIP}:${PORTS.TEST_INGRESS_PORT}/api/hassio_ingress/redacted/`;
  console.log(`Checking ingress at: ${ingressUrl}`);

  while (ingressWaitTime < ingressMaxWaitTime) {
    const ready = await isServerReady(ingressUrl);
    if (ready) {
      const elapsed = ((Date.now() - ingressStartTime) / 1000).toFixed(1);
      console.log(`Nginx ingress proxy is ready! (took ${elapsed}s)`);
      return;
    }

    await sleep(checkInterval);
    ingressWaitTime += checkInterval;
  }

  console.warn('Nginx ingress proxy did not respond within timeout, continuing anyway...');
}

/**
 * Create cleanup function for Docker container
 */
function createCleanupFunction(dockerProcess: ChildProcess): () => Promise<void> {
  return async () => {
    console.log('Cleaning up Docker container...');

    if (dockerProcess?.pid) {
      try {
        process.kill(dockerProcess.pid, 'SIGTERM');
      } catch (error) {
        console.log('Error killing Docker process:', error);
      }
    }

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

    await sleep(5000);
  };
}

/**
 * Starts the Docker container using the start-addon.sh script and waits for it to be ready.
 * Returns the docker process and a cleanup function.
 */
export async function startContainer(options: ContainerStartupOptions = {}): Promise<ContainerStartupResult> {
  const {
    maxWaitTime = 60 * 1000 * 5, // 5 minutes to allow for mastra dev initialization
    checkInterval = 2000,
    additionalInitTime = 5000,
    environmentVariables = {},
  } = options;

  const startTime = Date.now();
  console.log('Starting Docker container using start-addon.sh...');

  const env = { ...process.env, ...environmentVariables };

  // Use absolute path from project root
  // Default to /workspaces/hey-jarvis for devcontainer compatibility
  const workspaceRoot = process.env.WORKSPACE_ROOT || '/workspaces/hey-jarvis';
  const scriptPath = `${workspaceRoot}/home-assistant-addon/tests/start-addon.sh`;
  const dockerProcess = spawn('bash', [scriptPath], {
    stdio: 'inherit',
    detached: false,
    env,
  });

  console.log('Waiting for container to start...');

  await waitForServers(startTime, maxWaitTime, checkInterval);
  await waitForIngressProxy(checkInterval);
  await sleep(additionalInitTime);

  return {
    dockerProcess,
    cleanup: createCleanupFunction(dockerProcess),
  };
}
