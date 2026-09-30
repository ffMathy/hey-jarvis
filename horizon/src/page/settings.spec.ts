import { describe, expect, it } from 'bun:test';
import { ELEVENLABS_SETTINGS_STORAGE_KEY, HEADSET_PARTICIPANT_NAME } from 'hologram';
import { checkSettings, type KeyValueStorage, loadSettings, saveSettings, UNREACHABLE } from './settings';

class MemoryStorage implements KeyValueStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const brokenStorage: KeyValueStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

const SETTINGS = { apiKey: 'sk_test_key', agentId: 'agent_01jz' };

/** A fetch that answers every request with `status` and `body`, and remembers what it was asked. */
function answering(status: number, body: unknown) {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImplementation = async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { requests, fetch: Object.assign(fetchImplementation, { preconnect: fetch.preconnect }) };
}

describe('loadSettings and saveSettings', () => {
  it('keeps the settings under the key and in the format the phone’s web build reads', () => {
    const storage = new MemoryStorage();
    expect(saveSettings(storage, SETTINGS)).toBeUndefined();
    expect(JSON.parse(storage.values.get(ELEVENLABS_SETTINGS_STORAGE_KEY) ?? '')).toEqual(SETTINGS);
    expect(loadSettings(storage)).toEqual(SETTINGS);
  });

  it('finds nothing on a first visit, in an entry of another shape, or in storage that throws', () => {
    const storage = new MemoryStorage();
    expect(loadSettings(storage)).toBeUndefined();
    storage.setItem(ELEVENLABS_SETTINGS_STORAGE_KEY, '{"url":"http://old-server"}');
    expect(loadSettings(storage)).toBeUndefined();
    storage.setItem(ELEVENLABS_SETTINGS_STORAGE_KEY, 'not json');
    expect(loadSettings(storage)).toBeUndefined();
    expect(loadSettings(brokenStorage)).toBeUndefined();
  });

  it('says why when the browser will not keep them', () => {
    expect(saveSettings(brokenStorage, SETTINGS)).toContain('would not keep');
  });
});

describe('checkSettings', () => {
  it('refuses what cannot be a key or an agent ID without asking anyone', async () => {
    const { requests, fetch } = answering(200, {});
    expect(await checkSettings('', 'agent_01jz', fetch)).toEqual({ problem: 'Enter your ElevenLabs API key.' });
    expect(await checkSettings('sk_key', 'https://elevenlabs.io/app/agents/agent_01jz', fetch)).toMatchObject({
      problem: expect.stringContaining('just the ID'),
    });
    expect(requests).toEqual([]);
  });

  it('mints one token as the headset, and accepts the settings when ElevenLabs does', async () => {
    const { requests, fetch } = answering(200, { token: 'token', conversation_id: 'conversation' });
    expect(await checkSettings('  sk_test_key ', ' agent_01jz ', fetch)).toEqual({ settings: SETTINGS });
    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]?.url ?? '');
    expect(url.searchParams.get('participant_name')).toBe(HEADSET_PARTICIPANT_NAME);
    expect(url.searchParams.get('agent_id')).toBe('agent_01jz');
    expect(requests[0]?.init?.headers).toEqual({ 'xi-api-key': 'sk_test_key' });
  });

  it('shows ElevenLabs’ refusal in the page’s words', async () => {
    const rejected = answering(401, { detail: { status: 'invalid_api_key', message: 'sk_test_key is bad' } });
    const result = await checkSettings('sk_test_key', 'agent_01jz', rejected.fetch);
    expect(result).toEqual({ problem: 'ElevenLabs rejected the API key. Check it in the settings.' });
    expect(JSON.stringify(result)).not.toContain('is bad');

    const unknownAgent = answering(404, {});
    expect(await checkSettings('sk_test_key', 'agent_01jz', unknownAgent.fetch)).toMatchObject({
      problem: expect.stringContaining('no agent with that ID'),
    });
  });

  it('says so plainly when ElevenLabs cannot be reached', async () => {
    const offline = Object.assign(
      async () => {
        throw new TypeError('Failed to fetch');
      },
      { preconnect: fetch.preconnect },
    );
    expect(await checkSettings('sk_test_key', 'agent_01jz', offline)).toEqual({ problem: UNREACHABLE });
  });
});
