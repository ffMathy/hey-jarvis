import type { ServerMessage } from './conversation-strategy';

/**
 * Integrations the agent could not connect to, as it reported them.
 * With none connected the agent has no tools at all, and answers by writing
 * something that reads like a tool call into its own reply instead of making one.
 */
export function findDisconnectedIntegrations(messages: ServerMessage[]): string[] {
  return messages
    .filter((message) => message.type === 'mcp_connection_status')
    .flatMap((message) => message.mcp_connection_status.integrations)
    .filter((integration) => !integration.is_connected)
    .map((integration) => `${integration.integration_id} (${integration.tool_count} tools)`);
}

/**
 * An agent whose MCP server never connected has nothing to call, so say that
 * outright rather than letting the evaluator score a conversation that never had
 * tools in the first place. This one stays a hard failure: it is a broken
 * precondition, not a result to be judged.
 */
export function assertMcpServerConnected(messages: ServerMessage[]): void {
  const disconnectedIntegrations = findDisconnectedIntegrations(messages);
  if (disconnectedIntegrations.length === 0) return;

  throw new Error(
    `The agent reported no connection to its MCP server, leaving it without tools: ` +
      `[${disconnectedIntegrations.join(', ')}]. ElevenLabs has to be able to reach the MCP server ` +
      `through the cloudflared tunnel for this test to mean anything.`,
  );
}
