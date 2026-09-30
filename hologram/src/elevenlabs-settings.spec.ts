import { describe, expect, it } from 'bun:test';
import {
  describeAgentIdProblem,
  describeApiKeyProblem,
  ELEVENLABS_SETTINGS_STORAGE_KEY,
  parseElevenLabsSettings,
  parseStoredElevenLabsSettings,
  serialiseElevenLabsSettings,
} from './elevenlabs-settings';

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

  it('refuses a dashboard link or a whole line from an env file', () => {
    expect(describeAgentIdProblem('https://elevenlabs.io/app/agents/agents/agent_01jz')).toContain('just the ID');
    expect(describeAgentIdProblem('HEY_JARVIS_ELEVENLABS_AGENT_ID=agent_01jz')).toContain('just the ID');
  });

  it('accepts an older agent ID without the agent_ prefix', () => {
    expect(describeAgentIdProblem('J3Pbu5gP6NNKBscdCdwB')).toBeUndefined();
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

/**
 * What is kept in the device's key-value store, which the phone app and the headset's page both
 * read — the page shares the phone's web build's `localStorage`, so a change here reaches both.
 */
describe('the stored settings', () => {
  it('are kept under the key every app reads them from', () => {
    // Renaming it strands every install's saved settings, on the phone and in the headset alike.
    expect(ELEVENLABS_SETTINGS_STORAGE_KEY).toBe('jarvis.elevenlabs-settings');
  });

  it('read back exactly what was written', () => {
    const settings = { apiKey: 'sk_0123456789abcdef', agentId: 'agent_01jz0123456789' };

    expect(parseStoredElevenLabsSettings(serialiseElevenLabsSettings(settings))).toEqual(settings);
  });

  it('are written as the JSON the phone has always kept', () => {
    // Installs already have this on them, so the shape is fixed, not a detail.
    expect(serialiseElevenLabsSettings({ apiKey: 'sk_key', agentId: 'agent_01jz' })).toBe(
      '{"apiKey":"sk_key","agentId":"agent_01jz"}',
    );
  });

  it('read as nothing when either value is missing, empty or not text', () => {
    for (const stored of [
      '{"apiKey":"sk_key"}',
      '{"agentId":"agent_01jz"}',
      '{"apiKey":"","agentId":"agent_01jz"}',
      '{"apiKey":"sk_key","agentId":""}',
      '{"apiKey":7,"agentId":"agent_01jz"}',
      'null',
      '"sk_key"',
      '[]',
    ]) {
      expect(parseStoredElevenLabsSettings(stored)).toBeUndefined();
    }
  });

  it('keep only the two values, whatever else was stored beside them', () => {
    expect(parseStoredElevenLabsSettings('{"apiKey":"sk_key","agentId":"agent_01jz","serverUrl":"x"}')).toEqual({
      apiKey: 'sk_key',
      agentId: 'agent_01jz',
    });
  });

  it('throw on text that is not JSON at all, leaving the caller to say what that means', () => {
    expect(() => parseStoredElevenLabsSettings('not json')).toThrow();
  });
});
