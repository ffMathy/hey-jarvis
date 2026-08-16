import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import type { McpServerConfigOutput } from '@elevenlabs/elevenlabs-js/api';
import agentConfig from '../../src/assets/agent-config.json';
import { TEST_AGENT_MCP_SERVER_ID } from '../../src/main.js';

/**
 * How ElevenLabs authenticates to an MCP server, without disclosing any of it.
 * Header names are worth seeing — CF-Access-* would mean the tunnel is doing the
 * authenticating — but their values, and the secret token itself, are not.
 */
function describeAuthentication(config: McpServerConfigOutput): string {
  const headerNames = Object.keys(config.requestHeaders ?? {});
  return (
    `transport=${config.transport} approvalPolicy=${config.approvalPolicy} ` +
    `hasSecretToken=${Boolean(config.secretToken)} ` +
    `requestHeaders=[${headerNames.join(', ')}]`
  );
}

async function fetchConfig(client: ElevenLabsClient, serverId: string): Promise<McpServerConfigOutput | undefined> {
  const [result] = await Promise.allSettled([client.conversationalAi.mcpServers.get(serverId)]);
  if (result.status !== 'fulfilled') {
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    console.log(`🔍 Could not read MCP integration ${serverId}: ${reason}`);
    return undefined;
  }
  return result.value.config;
}

/**
 * Reports how ElevenLabs is configured to reach the MCP servers, for the test
 * agent and for production.
 *
 * The tunnel demonstrably serves /api/mcp to the public internet, so what is
 * left is ElevenLabs' own side of the arrangement. Production is included
 * because it is the only working example available: whatever it does that the
 * test integration does not is the difference worth chasing. Its URL stays out
 * of the output — these logs are public, and the test hostname is already in
 * them by way of Cloudflare's own error pages.
 */
export async function reportMcpIntegrations(): Promise<void> {
  const client = new ElevenLabsClient({ apiKey: process.env.HEY_JARVIS_ELEVENLABS_API_KEY });

  const testConfig = await fetchConfig(client, TEST_AGENT_MCP_SERVER_ID);
  if (testConfig) {
    const expectedUrl = `${process.env.HEY_JARVIS_CLOUDFLARED_TUNNEL_URL}/api/mcp`;
    console.log(
      `🔍 Test agent MCP integration: url=${testConfig.url} matchesTunnel=${testConfig.url === expectedUrl} ` +
        describeAuthentication(testConfig),
    );
  }

  const [productionServerId] = agentConfig.conversationConfig.agent.prompt.mcpServerIds;
  if (!productionServerId) {
    return;
  }

  const productionConfig = await fetchConfig(client, productionServerId);
  if (productionConfig) {
    console.log(`🔍 Production MCP integration: ${describeAuthentication(productionConfig)}`);
  }
}
