import { promisify } from 'util';

const sleep = promisify(setTimeout);

const CONTAINER_NAME = 'mcp-docker-test';

/**
 * Get the container's IP address for direct Docker network access.
 *
 * In devcontainer environments with Docker-in-Docker, port forwarding to localhost doesn't work
 * because the mapped ports are on the HOST machine, not accessible within the devcontainer.
 * The solution is to access containers directly via their Docker bridge network IP address.
 */
export async function getContainerIP(): Promise<string> {
  const { execSync } = await import('child_process');

  const maxRetries = 60;
  const retryInterval = 500;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = execSync(`docker inspect --format='{{.NetworkSettings.IPAddress}}' ${CONTAINER_NAME}`, {
        encoding: 'utf-8',
      }).trim();

      if (result && result !== '<no value>') {
        return result;
      }
    } catch {
      // Container may not be ready yet
    }

    await sleep(retryInterval);
  }

  throw new Error('Failed to get container IP address after 30 seconds');
}

export { CONTAINER_NAME };
