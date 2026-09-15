import { describe, expect, it } from 'bun:test';
import { CONVERSATION_TOKEN_URL, MOBILE_PARTICIPANT_NAME, requestConversationToken } from './conversation-token';
import type { ElevenLabsSettings } from './elevenlabs-settings';

const SETTINGS: ElevenLabsSettings = {
  apiKey: 'sk_a-secret-key',
  agentId: 'agent_01jz0123456789',
};

/** A fetch that answers with one canned response and records what it was called with. */
function createFetchStub(response: Response): typeof fetch & { calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  const fetchStub = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return response;
  };

  return Object.assign(fetchStub as unknown as typeof fetch, { calls });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const TOKEN_BODY = { token: 'a-webrtc-token', conversation_id: 'conv_1' };

describe('requestConversationToken', () => {
  it('asks ElevenLabs for a token for the configured agent and returns it', async () => {
    const fetchStub = createFetchStub(jsonResponse(TOKEN_BODY));

    const token = await requestConversationToken(SETTINGS, fetchStub);

    expect(token).toEqual({ token: 'a-webrtc-token', conversationId: 'conv_1' });
    const url = new URL(fetchStub.calls[0]?.url ?? '');
    expect(`${url.origin}${url.pathname}`).toBe(CONVERSATION_TOKEN_URL);
    expect(url.searchParams.get('agent_id')).toBe('agent_01jz0123456789');
    expect(fetchStub.calls[0]?.init?.method).toBe('GET');
  });

  it('authenticates with the API key as xi-api-key, and in no other way', async () => {
    const fetchStub = createFetchStub(jsonResponse(TOKEN_BODY));

    await requestConversationToken(SETTINGS, fetchStub);

    const headers = fetchStub.calls[0]?.init?.headers as Record<string, string> | undefined;
    expect(headers).toEqual({ 'xi-api-key': 'sk_a-secret-key' });
    // Not in the URL, where it would end up in logs.
    expect(fetchStub.calls[0]?.url).not.toContain('sk_a-secret-key');
  });

  it('names itself so the conversation is recognisable in the history', async () => {
    const fetchStub = createFetchStub(jsonResponse(TOKEN_BODY));

    await requestConversationToken(SETTINGS, fetchStub);

    expect(new URL(fetchStub.calls[0]?.url ?? '').searchParams.get('participant_name')).toBe(MOBILE_PARTICIPANT_NAME);
  });

  it('escapes an agent ID rather than letting it rewrite the query', async () => {
    const fetchStub = createFetchStub(jsonResponse(TOKEN_BODY));

    await requestConversationToken({ ...SETTINGS, agentId: 'agent&participant_name=x' }, fetchStub);

    const url = new URL(fetchStub.calls[0]?.url ?? '');
    expect(url.searchParams.get('agent_id')).toBe('agent&participant_name=x');
    expect(url.searchParams.getAll('participant_name')).toEqual([MOBILE_PARTICIPANT_NAME]);
  });

  it('explains a rejected API key in terms of the setting to fix', async () => {
    const fetchStub = createFetchStub(jsonResponse({ detail: { status: 'invalid_api_key' } }, 401));

    await expect(requestConversationToken(SETTINGS, fetchStub)).rejects.toThrow(/rejected the API key/);
  });

  it('explains a key that exists but may not start conversations', async () => {
    const fetchStub = createFetchStub(jsonResponse({}, 403));

    await expect(requestConversationToken(SETTINGS, fetchStub)).rejects.toThrow(/not allowed to start conversations/);
  });

  it('explains an agent ID the account does not have', async () => {
    for (const status of [404, 422]) {
      const fetchStub = createFetchStub(jsonResponse({}, status));

      await expect(requestConversationToken(SETTINGS, fetchStub)).rejects.toThrow(/no agent with that ID/);
    }
  });

  it('explains being rate limited or out of credits', async () => {
    const fetchStub = createFetchStub(jsonResponse({}, 429));

    await expect(requestConversationToken(SETTINGS, fetchStub)).rejects.toThrow(/out of credits/);
  });

  it('reports the status when ElevenLabs fails for some other reason', async () => {
    const fetchStub = createFetchStub(jsonResponse({}, 500));

    await expect(requestConversationToken(SETTINGS, fetchStub)).rejects.toThrow(/HTTP 500/);
  });

  it('never repeats the response body in the error, since it can echo the key', async () => {
    const fetchStub = createFetchStub(jsonResponse({ detail: 'bad key sk_a-secret-key' }, 401));

    await expect(requestConversationToken(SETTINGS, fetchStub)).rejects.not.toThrow(/sk_a-secret-key/);
  });

  it('refuses a successful response that carries no token, rather than passing undefined on', async () => {
    const fetchStub = createFetchStub(jsonResponse({ conversation_id: 'conv_1' }));

    await expect(requestConversationToken(SETTINGS, fetchStub)).rejects.toThrow(/without a conversation token/);
  });

  it('refuses a token that is an empty string', async () => {
    const fetchStub = createFetchStub(jsonResponse({ token: '', conversation_id: 'conv_1' }));

    await expect(requestConversationToken(SETTINGS, fetchStub)).rejects.toThrow(/without a conversation token/);
  });
});
