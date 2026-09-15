import { describe, expect, it } from 'bun:test';
import { describeAgentIdProblem, describeApiKeyProblem, parseElevenLabsSettings } from './elevenlabs-settings';

describe('describeApiKeyProblem', () => {
  it('accepts a key', () => {
    expect(describeApiKeyProblem('sk_0123456789abcdef')).toBeUndefined();
  });

  it('forgives the whitespace a paste picks up', () => {
    expect(describeApiKeyProblem('  sk_0123456789abcdef\n')).toBeUndefined();
  });

  it('refuses an empty key', () => {
    expect(describeApiKeyProblem('   ')).toContain('API key');
  });

  it('refuses a key with a space inside it, which is always a bad paste', () => {
    expect(describeApiKeyProblem('API key: sk_0123456789abcdef')).toContain('space');
  });
});

describe('describeAgentIdProblem', () => {
  it('accepts an agent ID', () => {
    expect(describeAgentIdProblem('agent_01jz0123456789')).toBeUndefined();
  });

  it('refuses an empty agent ID', () => {
    expect(describeAgentIdProblem('')).toContain('agent');
  });

  it('refuses an agent ID with a space inside it', () => {
    expect(describeAgentIdProblem('agent_01 jz')).toContain('space');
  });
});

describe('parseElevenLabsSettings', () => {
  it('returns trimmed settings when both values are usable', () => {
    expect(parseElevenLabsSettings(' sk_key \n', '\tagent_01jz ')).toEqual({
      settings: { apiKey: 'sk_key', agentId: 'agent_01jz' },
    });
  });

  it('reports the API key first when both are wrong, since it is the field above', () => {
    expect(parseElevenLabsSettings('', '')).toEqual({ problem: 'Enter your ElevenLabs API key.' });
  });

  it('reports a missing agent ID once the key is fine', () => {
    expect(parseElevenLabsSettings('sk_key', '')).toEqual({ problem: 'Enter the ID of the Jarvis agent.' });
  });
});
