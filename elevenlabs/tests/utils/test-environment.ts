import {
  isMcpServerRunning,
  startMcpServerForTestingPurposes,
  stopMcpServer,
} from '../../../mcp/tests/utils/mcp-server-manager.js';
import { deployTestAgent } from '../../src/main.js';
import { reportMcpIntegrations } from './mcp-integration.js';
import { ensureTunnelRunning, isTunnelHealthy, stopTunnel } from './tunnel-manager.js';

/**
 * The MCP server and cloudflared tunnel every live conversation eval runs against.
 *
 * Both live on fixed ports and are torn down between spec files, so the teardown
 * of one file and the setup of the next are talking about the same processes.
 * That only works if the teardown has actually finished first: `stopMcpServer`
 * kills whatever holds port 4112, so a teardown still in flight when the next
 * file starts its server kills that one instead, and the next file spends thirty
 * retries watching a server that was shot the moment it came up.
 *
 * Hence both halves live here and both are awaited by their callers. The hooks
 * are `beforeAll(startTestEnvironment)` and `afterAll(stopTestEnvironment)`,
 * which return promises the runner waits on — an `afterAll` that calls
 * `stopMcpServer()` without awaiting it does not.
 */
export async function startTestEnvironment(): Promise<void> {
  if (!process.env.HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID) {
    throw new Error('HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID environment variable is required');
  }

  // Order matters. ElevenLabs hosts the agent and reads its MCP tool list when
  // the agent is updated, so the server has to be answering on its public
  // hostname before the deploy — otherwise the agent is left holding
  // tool_count: 0 for a URL that only came alive afterwards.
  await startMcpServerForTestingPurposes();
  await ensureTunnelRunning();
  await deployTestAgent();
  await reportMcpIntegrations();
}

/**
 * Brings the environment back if it has gone, before a conversation is held against it.
 *
 * Bun kills a timed-out test's "dangling processes" on its way out, and the MCP server and the
 * tunnel are exactly that, whichever hook started them. So one conversation that overran its
 * test used to leave every spec after it talking to an agent with no MCP server behind it --
 * reported by ElevenLabs as connected with zero tools, spec after spec, each one a failure
 * that said nothing about the prompt it was meant to test.
 *
 * Starting over is the whole of `startTestEnvironment`, the deploy included: ElevenLabs reads
 * the tool list when the agent is updated, so a server that came back without a deploy could
 * still be held at zero tools.
 */
export async function ensureTestEnvironment(): Promise<void> {
  if ((await isMcpServerRunning()) && (await isTunnelHealthy())) {
    return;
  }

  console.warn('⚠️ The MCP server or the tunnel is gone; bringing the test environment back up');
  await startTestEnvironment();
}

export async function stopTestEnvironment(): Promise<void> {
  await stopMcpServer();
  stopTunnel();
}

/**
 * How long the environment may take to come up. The MCP server and cloudflared
 * registering with Cloudflare's edge can each take tens of seconds on a cold CI
 * runner, before the deploy even starts.
 */
export const TEST_ENVIRONMENT_SETUP_TIMEOUT_MS = 240000;
