import { type ChildProcess, execSync, spawn } from 'child_process';
import { promisify } from 'util';
import { CONTAINER_NAME, getContainerIP } from './docker-helper';
import { PORTS } from './ports';

const sleep = promisify(setTimeout);

export interface ContainerStartupResult {
  dockerProcess: ChildProcess;
  containerIP: string;
  cleanup: () => Promise<void>;
}

export interface ContainerStartupOptions {
  maxWaitTime?: number;
  checkInterval?: number;
  additionalInitTime?: number;
}

async function isServerReady(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return response.status < 500;
  } catch {
    return false;
  }
}

/**
 * Wait for Mastra dev (API + Studio on same port) and MCP server to be healthy
 */
async function waitForServers(startTime: number, maxWaitTime: number, checkInterval: number): Promise<string> {
  let waitTime = 0;
  const readyStatus = { mastra: false, mcp: false };

  const containerIP = await getContainerIP();
  const mastraUrl = `http://${containerIP}:${PORTS.MASTRA_DEV}/health`;
  const mcpUrl = `http://${containerIP}:${PORTS.MCP_SERVER_INTERNAL}/health`;

  console.log(`Accessing servers via Docker bridge network IP: ${containerIP}`);
  console.log(`  Mastra dev (API + Studio): ${mastraUrl}`);
  console.log(`  MCP server: ${mcpUrl}`);

  while (waitTime < maxWaitTime) {
    if (!readyStatus.mastra && (await isServerReady(mastraUrl))) {
      readyStatus.mastra = true;
      console.log(`Mastra dev is ready! (took ${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
    }

    if (!readyStatus.mcp && (await isServerReady(mcpUrl))) {
      readyStatus.mcp = true;
      console.log(`MCP server is ready! (took ${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
    }

    if (readyStatus.mastra && readyStatus.mcp) {
      return containerIP;
    }

    await sleep(checkInterval);
    waitTime += checkInterval;

    if (waitTime % 30000 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`Still waiting... (${elapsed}s) - Mastra: ${readyStatus.mastra}, MCP: ${readyStatus.mcp}`);
    }
  }

  throw new Error(
    `Container failed to start within timeout (${((Date.now() - startTime) / 1000).toFixed(1)}s). ` +
      `Mastra: ${readyStatus.mastra}, MCP: ${readyStatus.mcp}`,
  );
}

function createCleanupFunction(dockerProcess: ChildProcess): () => Promise<void> {
  return async () => {
    console.log('Cleaning up Docker container...');

    if (dockerProcess?.pid) {
      try {
        process.kill(dockerProcess.pid, 'SIGTERM');
      } catch {
        // ESRCH is expected for detached docker processes
      }
    }

    try {
      execSync(`docker stop ${CONTAINER_NAME}`, { stdio: 'inherit' });
    } catch {
      // Container may already be stopped
    }

    try {
      execSync(`docker rm -f ${CONTAINER_NAME}`, { stdio: 'inherit' });
    } catch {
      // Container may already be removed
    }

    await sleep(2000);
  };
}

/**
 * Build the MCP Docker image and start a container for testing.
 * Returns the container IP and a cleanup function.
 */
export async function startContainer(options: ContainerStartupOptions = {}): Promise<ContainerStartupResult> {
  const { maxWaitTime = 180 * 1000, checkInterval = 2000, additionalInitTime = 5000 } = options;

  const startTime = Date.now();

  // Stop any existing test container
  try {
    execSync(`docker stop ${CONTAINER_NAME} 2>/dev/null || true`, { stdio: 'inherit' });
    execSync(`docker rm -f ${CONTAINER_NAME} 2>/dev/null || true`, { stdio: 'inherit' });
  } catch {
    // Ignore errors
  }

  // Build the MCP Docker image
  console.log('🐳 Building MCP Docker image...');
  execSync('docker build -f mcp/Dockerfile -t mcp-test:latest .', {
    stdio: 'inherit',
    cwd: '/workspaces/hey-jarvis',
    timeout: 300000,
  });
  console.log(`✅ Docker image built (took ${((Date.now() - startTime) / 1000).toFixed(1)}s)`);

  // Start the container with required env vars
  console.log('🚀 Starting MCP Docker container...');
  const dockerProcess = spawn(
    'docker',
    [
      'run',
      '--detach',
      '--name',
      CONTAINER_NAME,
      '-p',
      `${PORTS.TEST_MASTRA_DEV}:${PORTS.MASTRA_DEV}`,
      '-p',
      `${PORTS.TEST_MCP_SERVER}:${PORTS.MCP_SERVER_INTERNAL}`,
      'mcp-test:latest',
    ],
    {
      stdio: 'inherit',
      detached: false,
    },
  );

  // Wait for the container to come up
  console.log('Waiting for container services to start...');
  const containerIP = await waitForServers(startTime, maxWaitTime, checkInterval);
  await sleep(additionalInitTime);

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`✅ All services ready (total: ${totalTime}s)`);

  return {
    dockerProcess,
    containerIP,
    cleanup: createCleanupFunction(dockerProcess),
  };
}
