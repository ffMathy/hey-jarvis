import { describe, expect, it } from 'bun:test';
import {
  CONVERSATION_TOKEN_URL,
  type ConversationRequest,
  PHONE_PARTICIPANT_NAME,
  requestConversationToken,
  requestSignedConversationUrl,
  SIGNED_CONVERSATION_URL,
  WATCH_PARTICIPANT_NAME,
} from './conversation-token';
import type { ElevenLabsSettings } from './elevenlabs-settings';

const SETTINGS: ElevenLabsSettings = {
  apiKey: 'sk_a-secret-key',
  agentId: 'agent_01jz0123456789',
};

/** The phone asking, which is what most of these are about. The device only changes one query parameter. */
const FROM_THE_PHONE: ConversationRequest = { settings: SETTINGS, participantName: PHONE_PARTICIPANT_NAME };

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

    const token = await requestConversationToken(FROM_THE_PHONE, fetchStub);

    expect(token).toEqual({ token: 'a-webrtc-token', conversationId: 'conv_1' });
    const url = new URL(fetchStub.calls[0]?.url ?? '');
    expect(`${url.origin}${url.pathname}`).toBe(CONVERSATION_TOKEN_URL);
    expect(url.searchParams.get('agent_id')).toBe('agent_01jz0123456789');
    expect(fetchStub.calls[0]?.init?.method).toBe('GET');
  });

  it('authenticates with the API key as xi-api-key, and in no other way', async () => {
    const fetchStub = createFetchStub(jsonResponse(TOKEN_BODY));

    await requestConversationToken(FROM_THE_PHONE, fetchStub);

    const headers = fetchStub.calls[0]?.init?.headers as Record<string, string> | undefined;
    expect(headers).toEqual({ 'xi-api-key': 'sk_a-secret-key' });
    // Not in the URL, where it would end up in logs.
    expect(fetchStub.calls[0]?.url).not.toContain('sk_a-secret-key');
  });

  it('names itself so the conversation is recognisable in the history', async () => {
    const fetchStub = createFetchStub(jsonResponse(TOKEN_BODY));

    await requestConversationToken(FROM_THE_PHONE, fetchStub);

    expect(new URL(fetchStub.calls[0]?.url ?? '').searchParams.get('participant_name')).toBe(PHONE_PARTICIPANT_NAME);
  });

  it('lets the watch name itself, so the two devices are told apart in the history', async () => {
    // The whole reason the name is a parameter rather than a constant in this file. A watch
    // borrowing the phone's name would make a conversation held on the wrist indistinguishable
    // from one held in a pocket.
    const fetchStub = createFetchStub(jsonResponse(TOKEN_BODY));

    await requestConversationToken({ settings: SETTINGS, participantName: WATCH_PARTICIPANT_NAME }, fetchStub);

    expect(new URL(fetchStub.calls[0]?.url ?? '').searchParams.get('participant_name')).toBe(WATCH_PARTICIPANT_NAME);
    expect(WATCH_PARTICIPANT_NAME).not.toBe(PHONE_PARTICIPANT_NAME);
  });

  it('escapes an agent ID rather than letting it rewrite the query', async () => {
    const fetchStub = createFetchStub(jsonResponse(TOKEN_BODY));

    await requestConversationToken(
      { ...FROM_THE_PHONE, settings: { ...SETTINGS, agentId: 'agent&participant_name=x' } },
      fetchStub,
    );

    const url = new URL(fetchStub.calls[0]?.url ?? '');
    expect(url.searchParams.get('agent_id')).toBe('agent&participant_name=x');
    expect(url.searchParams.getAll('participant_name')).toEqual([PHONE_PARTICIPANT_NAME]);
  });

  it('explains a rejected API key in terms of the setting to fix', async () => {
    const fetchStub = createFetchStub(
      jsonResponse({ detail: { status: 'invalid_api_key', message: 'Invalid API key' } }, 401),
    );

    await expect(requestConversationToken(FROM_THE_PHONE, fetchStub)).rejects.toThrow(/rejected the API key/);
  });

  it('explains a right key without permission, which ElevenLabs also answers with 401', async () => {
    // The app recommends a restricted key; one restricted too far must not be
    // reported as a typo the user will keep re-pasting.
    const fetchStub = createFetchStub(jsonResponse({ detail: { status: 'missing_permissions' } }, 401));

    await expect(requestConversationToken(FROM_THE_PHONE, fetchStub)).rejects.toThrow(
      /not allowed to start conversations/,
    );
  });

  it('explains a key that exists but may not start conversations', async () => {
    const fetchStub = createFetchStub(jsonResponse({}, 403));

    await expect(requestConversationToken(FROM_THE_PHONE, fetchStub)).rejects.toThrow(
      /not allowed to start conversations/,
    );
  });

  it('explains an agent ID the account does not have', async () => {
    const fetchStub = createFetchStub(jsonResponse({}, 404));

    await expect(requestConversationToken(FROM_THE_PHONE, fetchStub)).rejects.toThrow(/no agent with that ID/);
  });

  it('explains a malformed agent ID, which ElevenLabs answers with 400', async () => {
    const fetchStub = createFetchStub(jsonResponse({ detail: { status: 'invalid_agent_id' } }, 400));

    await expect(requestConversationToken(FROM_THE_PHONE, fetchStub)).rejects.toThrow(/no agent with that ID/);
  });

  it('explains an account out of credits', async () => {
    const fetchStub = createFetchStub(jsonResponse({ detail: { code: 'insufficient_credits' } }, 402));

    await expect(requestConversationToken(FROM_THE_PHONE, fetchStub)).rejects.toThrow(/run out of credits/);
  });

  it('explains being rate limited without blaming credits', async () => {
    const fetchStub = createFetchStub(jsonResponse({}, 429));

    const error = await requestConversationToken(FROM_THE_PHONE, fetchStub).catch((caught: unknown) => caught);
    expect(String(error)).toContain('Try again shortly');
    expect(String(error)).not.toContain('credits');
  });

  it('reports the status when ElevenLabs fails for some other reason', async () => {
    const fetchStub = createFetchStub(jsonResponse({}, 500));

    await expect(requestConversationToken(FROM_THE_PHONE, fetchStub)).rejects.toThrow(/HTTP 500/);
  });

  it('copes with an error body that is not JSON', async () => {
    const fetchStub = createFetchStub(new Response('<html>Bad gateway</html>', { status: 502 }));

    await expect(requestConversationToken(FROM_THE_PHONE, fetchStub)).rejects.toThrow(/HTTP 502/);
  });

  it('never repeats anything from the response in an error, on any path, since it can echo the key', async () => {
    const echo = { detail: { status: 'sk_a-secret-key', code: 'sk_a-secret-key', message: 'bad key sk_a-secret-key' } };
    const responses = [400, 401, 402, 403, 404, 422, 429, 500, 503].map((status) => jsonResponse(echo, status));
    responses.push(jsonResponse({ ...echo, conversation_id: 'conv_1' }));

    for (const response of responses) {
      const error = await requestConversationToken(FROM_THE_PHONE, createFetchStub(response)).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain('sk_a-secret-key');
    }
  });

  it('refuses a successful response that carries no token, rather than passing undefined on', async () => {
    const fetchStub = createFetchStub(jsonResponse({ conversation_id: 'conv_1' }));

    await expect(requestConversationToken(FROM_THE_PHONE, fetchStub)).rejects.toThrow(/without a conversation token/);
  });

  it('refuses a token that is an empty string', async () => {
    const fetchStub = createFetchStub(jsonResponse({ token: '', conversation_id: 'conv_1' }));

    await expect(requestConversationToken(FROM_THE_PHONE, fetchStub)).rejects.toThrow(/without a conversation token/);
  });
});

const SIGNED_URL = 'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_01jz0123456789&token=abc';

describe('requestSignedConversationUrl', () => {
  it('asks ElevenLabs to sign a URL for the configured agent and returns it', async () => {
    const fetchStub = createFetchStub(jsonResponse({ signed_url: SIGNED_URL }));

    const signedUrl = await requestSignedConversationUrl(SETTINGS, fetchStub);

    expect(signedUrl).toBe(SIGNED_URL);
    const url = new URL(fetchStub.calls[0]?.url ?? '');
    expect(`${url.origin}${url.pathname}`).toBe(SIGNED_CONVERSATION_URL);
    expect(url.searchParams.get('agent_id')).toBe('agent_01jz0123456789');
    expect(fetchStub.calls[0]?.init?.method).toBe('GET');
  });

  it('authenticates with the API key as xi-api-key, and never puts it in the URL', async () => {
    const fetchStub = createFetchStub(jsonResponse({ signed_url: SIGNED_URL }));

    await requestSignedConversationUrl(SETTINGS, fetchStub);

    expect(fetchStub.calls[0]?.init?.headers).toEqual({ 'xi-api-key': 'sk_a-secret-key' });
    expect(fetchStub.calls[0]?.url).not.toContain('sk_a-secret-key');
  });

  it('explains a failure the same way a token request does, so the fix is the same either way', async () => {
    const fetchStub = createFetchStub(jsonResponse({ detail: { status: 'invalid_api_key' } }, 401));

    await expect(requestSignedConversationUrl(SETTINGS, fetchStub)).rejects.toThrow(/rejected the API key/);
  });

  it('never repeats anything from the response in an error, since it can echo the key', async () => {
    const echo = { detail: { status: 'sk_a-secret-key', code: 'sk_a-secret-key', message: 'bad key sk_a-secret-key' } };
    const responses = [400, 401, 403, 404, 429, 500].map((status) => jsonResponse(echo, status));
    responses.push(jsonResponse({ ...echo, signed_url: 'http://elsewhere.example/sk_a-secret-key' }));

    for (const response of responses) {
      const error = await requestSignedConversationUrl(SETTINGS, createFetchStub(response)).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain('sk_a-secret-key');
    }
  });

  it('refuses a successful response that carries no URL, rather than passing undefined on', async () => {
    const fetchStub = createFetchStub(jsonResponse({}));

    await expect(requestSignedConversationUrl(SETTINGS, fetchStub)).rejects.toThrow(/without a conversation URL/);
  });

  it('refuses a URL that is not a secure socket, whatever else it is', async () => {
    // It is handed straight to a `WebSocket`, so a plain `ws://` here is the session in clear text
    // and an `https://` is a scheme nobody meant to open.
    for (const signedUrl of ['', 'ws://api.elevenlabs.io/v1/convai/conversation', 'https://elsewhere.example']) {
      const fetchStub = createFetchStub(jsonResponse({ signed_url: signedUrl }));

      await expect(requestSignedConversationUrl(SETTINGS, fetchStub)).rejects.toThrow(/without a conversation URL/);
    }
  });
});
