import { describe, expect, it } from 'bun:test';
import { readAgentConfig } from '../../src/agent-assets';
import { withPostCallWebhook } from '../../src/main.js';

const agentConfig = await readAgentConfig();

describe('withPostCallWebhook', () => {
  it('points the agent at the workspace webhook, keeping the events it sends', () => {
    const deployed = withPostCallWebhook(agentConfig, 'webhook_123');

    expect(deployed.platformSettings?.workspaceOverrides?.webhooks).toEqual({
      ...agentConfig.platformSettings?.workspaceOverrides?.webhooks,
      postCallWebhookId: 'webhook_123',
    });
  });

  it('sends the transcript, which carries the evaluation results the MCP server reads', () => {
    expect(agentConfig.platformSettings?.workspaceOverrides?.webhooks?.events).toContain('transcript');
  });

  it('has an evaluation criterion for the webhook to report on', () => {
    expect(agentConfig.platformSettings?.evaluation?.criteria?.length).toBeGreaterThan(0);
  });

  it('leaves the config alone without a webhook id', () => {
    expect(withPostCallWebhook(agentConfig, undefined)).toBe(agentConfig);
  });

  it('touches nothing else in the config', () => {
    const deployed = withPostCallWebhook(agentConfig, 'webhook_123');

    expect({ ...deployed, platformSettings: undefined }).toEqual({ ...agentConfig, platformSettings: undefined });
    expect(deployed.platformSettings?.evaluation).toEqual(agentConfig.platformSettings?.evaluation);
  });
});
