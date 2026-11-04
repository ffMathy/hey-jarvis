import { describe, expect, it } from 'bun:test';
import { PHONE_PARTICIPANT_NAME } from 'hologram';
import { conversationCredentialsOf } from './conversation-credentials';

const ADDRESS = 'https://jarvis.example.com';
const TOKEN = 'p'.repeat(43);

/** A fake of `fetch` that records where each conversation's token was asked for, and with what. */
function recordingFetch() {
  const asked: { url: string; authorization: string | null; body: unknown }[] = [];
  const answer = async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    asked.push({ url: String(url), authorization: headers.get('Authorization'), body: JSON.parse(String(init?.body)) });
    return Response.json({ data: { token: 'from-the-server' } });
  };
  return { asked, fetch: Object.assign(answer, { preconnect: fetch.preconnect }) };
}

describe('where a conversation’s token comes from', () => {
  it('is the paired server, with this device’s own token and its name in the history', async () => {
    const { asked, fetch } = recordingFetch();

    const token = await conversationCredentialsOf(ADDRESS, TOKEN)?.token(PHONE_PARTICIPANT_NAME, fetch);

    expect(token).toBe('from-the-server');
    expect(asked).toEqual([
      {
        url: `${ADDRESS}/api/paired/conversation`,
        authorization: `Bearer ${TOKEN}`,
        body: { transport: 'webrtc', participantName: PHONE_PARTICIPANT_NAME },
      },
    ]);
  });

  it('is nothing for a token with no server to send it to', () => {
    expect(conversationCredentialsOf(undefined, TOKEN)).toBeUndefined();
  });

  it('is nothing for a server this device was never paired with', () => {
    expect(conversationCredentialsOf(ADDRESS, undefined)).toBeUndefined();
  });
});
