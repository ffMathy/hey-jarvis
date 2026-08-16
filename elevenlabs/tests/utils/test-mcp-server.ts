const HEALTH_TIMEOUT_MS = 10000;

/**
 * Verifies the MCP server the ElevenLabs test agent talks to is reachable.
 *
 * The agent is hosted, so ElevenLabs — not this test run — is what connects to
 * the MCP server, and it only has tools while that server answers on its public
 * hostname. The deployment behind it is expected to stay up (see
 * mcp/docker-compose.test-tunnel.yml); this check exists so that when it is
 * down, the suite says so directly instead of every tool assertion failing as
 * though the agent had simply chosen not to call anything.
 */
export async function assertTestMcpServerReachable(): Promise<void> {
  const tunnelUrl = process.env.HEY_JARVIS_CLOUDFLARED_TUNNEL_URL;
  if (!tunnelUrl) {
    throw new Error('HEY_JARVIS_CLOUDFLARED_TUNNEL_URL environment variable is required');
  }

  const [result] = await Promise.allSettled([
    fetch(new URL('/health', tunnelUrl), { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) }),
  ]);

  if (result.status !== 'fulfilled') {
    // Carry the underlying reason through: a timeout, a refused connection and
    // an unresolvable name all land here, and they point at different problems.
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    throw new Error(
      'The MCP server for the test agent could not be reached over its public hostname. ' +
        'ElevenLabs needs it running to give the agent any tools — start the deployment in ' +
        `mcp/docker-compose.test-tunnel.yml. The request failed with: ${reason}`,
      { cause: result.reason },
    );
  }

  const response = result.value;
  if (!response.ok) {
    throw new Error(
      `The MCP server for the test agent answered ${response.status} on /health over its public hostname. ` +
        'A Cloudflare error code here means the tunnel has no connector running.',
    );
  }

  const [bodyResult] = await Promise.allSettled([response.json() as Promise<{ status?: string }>]);
  const status = bodyResult.status === 'fulfilled' ? bodyResult.value.status : undefined;
  if (status !== 'healthy') {
    throw new Error(
      `Something other than the MCP server answered /health over the test agent's public hostname (status: ${status}).`,
    );
  }

  console.log('✅ MCP server for the test agent is reachable over its public hostname');
}
