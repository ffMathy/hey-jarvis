import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { TEST_AGENT_MCP_SERVER_ID } from '../../src/main.js';

/**
 * Reports how ElevenLabs is configured to reach the MCP server.
 *
 * The tunnel is demonstrably serving /api/mcp to the public internet, yet the
 * agent still reports no connection — so what remains is what ElevenLabs itself
 * was told to dial. The URL and transport come from its side of the arrangement
 * and are the only part of the path the tests cannot otherwise see.
 *
 * Secrets configured on the integration are reported as present or absent, never
 * printed.
 */
export async function reportTestAgentMcpIntegration(): Promise<void> {
  const client = new ElevenLabsClient({ apiKey: process.env.HEY_JARVIS_ELEVENLABS_API_KEY });

  const [result] = await Promise.allSettled([client.conversationalAi.mcpServers.get(TEST_AGENT_MCP_SERVER_ID)]);
  if (result.status !== 'fulfilled') {
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    console.log(`🔍 Could not read the test agent's MCP integration: ${reason}`);
    return;
  }

  const { config } = result.value;
  const expectedUrl = `${process.env.HEY_JARVIS_CLOUDFLARED_TUNNEL_URL}/api/mcp`;

  console.log(
    `🔍 Test agent's MCP integration: url=${config.url} ` +
      `matchesTunnel=${config.url === expectedUrl} ` +
      `transport=${config.transport} ` +
      `approvalPolicy=${config.approvalPolicy} ` +
      `hasSecretToken=${Boolean(config.secretToken)} ` +
      `requestHeaders=${Object.keys(config.requestHeaders ?? {}).length}`,
  );
}
