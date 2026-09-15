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
    const fetchStub = createFetchStub(
      jsonResponse({ detail: { status: 'invalid_api_key', message: 'Invalid API key' } }, 401),
    );

    await expect(requestConversationToken(SETTINGS, fetchStub)).rejects.toThrow(/rejected the API key/);
  });

  it('explains a right key without permission, which ElevenLabs also answers with 401', async () => {
    // The app recommends a restricted key; one restricted too far must not be
    // reported as a typo the user will keep re-pasting.
    const fetchStub = createFetchStub(jsonResponse({ detail: { status: 'missing_permissions' } }, 401));

    await expect(requestConversationToken(SETTINGS, fetchStub)).rejects.toThrow(/not allowed to start conversations/);
  });

  it('explains a key that exists but may not start conversations', async () => {
    const fetchStub = createFetchStub(jsonResponse({}, 403));

    await expect(requestConversationToken(SETTINGS, fetchStub)).rejects.toThrow(/not allowed to start conversations/);
  });

  it('explains an agent ID the account does not have', async () => {
    const fetchStub = createFetchStub(jsonResponse({}, 404));

    await expect(requestConversationToken(SETTINGS, fetchStub)).rejects.toThrow(/no agent with that ID/);
  });

  it('explains a malformed agent ID, which ElevenLabs answers with 400', async () => {
    const fetchStub = createFetchStub(jsonResponse({ detail: { status: 'invalid_agent_id' } }, 400));

    await expect(requestConversationToken(SETTINGS, fetchStub)).rejects.toThrow(/no agent with that ID/);
  });

  it('explains an account out of credits', async () => {
    const fetchStub = createFetchStub(jsonResponse({ detail: { code: 'insufficient_credits' } }, 402));

    await expect(requestConversationToken(SETTINGS, fetchStub)).rejects.toThrow(/run out of credits/);
  });

  it('explains being rate limited without blaming credits', async () => {
    const fetchStub = createFetchStub(jsonResponse({}, 429));

    const error = await requestConversationToken(SETTINGS, fetchStub).catch((caught: unknown) => caught);
    expect(String(error)).toContain('Try again shortly');
    expect(String(error)).not.toContain('credits');
  });

  it('reports the status when ElevenLabs fails for some other reason', async () => {
    const fetchStub = createFetchStub(jsonResponse({}, 500));

    await expect(requestConversationToken(SETTINGS, fetchStub)).rejects.toThrow(/HTTP 500/);
  });

  it('copes with an error body that is not JSON', async () => {
    const fetchStub = createFetchStub(new Response('<html>Bad gateway</html>', { status: 502 }));

    await expect(requestConversationToken(SETTINGS, fetchStub)).rejects.toThrow(/HTTP 502/);
  });

  it('never repeats anything from the response in an error, on any path, since it can echo the key', async () => {
    const echo = { detail: { status: 'sk_a-secret-key', code: 'sk_a-secret-key', message: 'bad key sk_a-secret-key' } };
    const responses = [400, 401, 402, 403, 404, 422, 429, 500, 503].map((status) => jsonResponse(echo, status));
    responses.push(jsonResponse({ ...echo, conversation_id: 'conv_1' }));

    for (const response of responses) {
      const error = await requestConversationToken(SETTINGS, createFetchStub(response)).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain('sk_a-secret-key');
    }
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
