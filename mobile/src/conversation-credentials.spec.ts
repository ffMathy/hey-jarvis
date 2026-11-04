import { describe, expect, it } from 'bun:test';
import { PHONE_PARTICIPANT_NAME } from 'hologram';
import { conversationCredentialsOf } from './conversation-credentials';

const ADDRESS = 'https://jarvis.example.com';
const TOKEN = 'p'.repeat(43);
const SETTINGS = { apiKey: 'sk_a-key', agentId: 'agent_01jz' };

/** A fake of `fetch` that records where each conversation's token was asked for. */
function recordingFetch() {
  const asked: { url: string; authorization: string | null; key: string | null }[] = [];
  const answer = async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    asked.push({ url: String(url), authorization: headers.get('Authorization'), key: headers.get('xi-api-key') });
    return Response.json({ token: 'from-elevenlabs', conversation_id: 'conv_1', data: { token: 'from-the-server' } });
  };
  return { asked, fetch: Object.assign(answer, { preconnect: fetch.preconnect }) };
}

describe('where a conversation’s token comes from', () => {
  it('is the paired server, with the browser’s own token, when it is paired', async () => {
    const { asked, fetch } = recordingFetch();

    const token = await conversationCredentialsOf(ADDRESS, TOKEN, SETTINGS)?.token(PHONE_PARTICIPANT_NAME, fetch);

    expect(token).toBe('from-the-server');
    expect(asked).toEqual([{ url: `${ADDRESS}/api/paired/conversation`, authorization: `Bearer ${TOKEN}`, key: null }]);
  });

  it('is ElevenLabs, with the saved key, when it is not paired', async () => {
    const { asked, fetch } = recordingFetch();

    const token = await conversationCredentialsOf(ADDRESS, undefined, SETTINGS)?.token(PHONE_PARTICIPANT_NAME, fetch);

    expect(token).toBe('from-elevenlabs');
    expect(asked[0]?.url.startsWith('https://api.elevenlabs.io/')).toBe(true);
    expect(asked[0]?.key).toBe('sk_a-key');
  });

  it('is not the server for a token with no server to send it to', () => {
    expect(conversationCredentialsOf(undefined, TOKEN, undefined)).toBeUndefined();
  });

  it('is nothing with neither a pairing nor a key', () => {
    expect(conversationCredentialsOf(ADDRESS, undefined, undefined)).toBeUndefined();
  });
});
