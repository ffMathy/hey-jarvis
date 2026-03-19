import fkill from 'fkill';

/**
 * Kills any process listening on the specified port.
 * Uses the fkill package for cross-platform port-based process killing.
 *
 * @param port - The port number to kill processes on
 */
export async function killProcessOnPort(port: number): Promise<void> {
  try {
    await fkill(`:${port}`, { force: true, silent: true });
    console.log(`🧹 Killed process(es) on port ${port}`);
  } catch {
    // Ignore failures because no process on the port is a valid state.
  }
}
