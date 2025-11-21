import { spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { getMastraUIUrl } from './ports';

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

  // Track if the startup script exits early (indicates failure)
  let scriptExited = false;

  // Forward all process.env variables and merge with any additional ones
  const env = { ...process.env, ...environmentVariables };

  // Start the Docker container using start-addon.sh script
  const dockerProcess = spawn('bash', ['./home-assistant-addon/tests/start-addon.sh'], {
    stdio: 'pipe',
    detached: true,
    env,
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

  let waitTime = 0;

  while (waitTime < maxWaitTime) {
    // Check if startup script exited (indicates failure)
    if (scriptExited) {
      console.error('Docker process exited prematurely!');
      console.error('Exit code:', exitCode);
      console.error('Last output:', dockerOutput);
      console.error('Last errors:', dockerErrors);
      throw new Error(
        `Docker startup script exited with code ${exitCode} before container was ready - check logs above for details`,
      );
    }

    try {
      const response = await fetch(getMastraUIUrl());
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

  // Give it additional time to fully initialize
  await sleep(additionalInitTime);

  // Create cleanup function
  const cleanup = async () => {
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
