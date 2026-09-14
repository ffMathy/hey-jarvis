import { describe, expect, it } from 'bun:test';
import { CONVERSATION_TOKEN_PATH, MOBILE_PARTICIPANT_NAME, requestConversationToken } from './conversation-token';
import type { ServerSettings } from './server-settings';

const SETTINGS: ServerSettings = {
  serverUrl: 'https://jarvis.example.com',
  accessToken: 'a-secret',
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

describe('requestConversationToken', () => {
  it('asks the configured server and returns the token it hands back', async () => {
    const fetchStub = createFetchStub(
      jsonResponse({ success: true, data: { token: 'a-webrtc-token', conversationId: 'conv_1' } }),
    );

    const token = await requestConversationToken(SETTINGS, fetchStub);

    expect(token).toEqual({ token: 'a-webrtc-token', conversationId: 'conv_1' });
    expect(fetchStub.calls[0]?.url).toBe(`https://jarvis.example.com${CONVERSATION_TOKEN_PATH}`);
  });

  it('presents the access token as a bearer credential', async () => {
    const fetchStub = createFetchStub(
      jsonResponse({ success: true, data: { token: 'a-webrtc-token', conversationId: 'conv_1' } }),
    );

    await requestConversationToken(SETTINGS, fetchStub);

    const headers = fetchStub.calls[0]?.init?.headers as Record<string, string> | undefined;
    expect(headers?.authorization).toBe('Bearer a-secret');
  });

  it('names itself so the conversation is recognisable in the history', async () => {
    const fetchStub = createFetchStub(
      jsonResponse({ success: true, data: { token: 'a-webrtc-token', conversationId: 'conv_1' } }),
    );

    await requestConversationToken(SETTINGS, fetchStub);

    expect(JSON.parse(String(fetchStub.calls[0]?.init?.body))).toEqual({
      participantName: MOBILE_PARTICIPANT_NAME,
    });
  });

  it('explains a rejected access token in terms of the setting to fix', async () => {
    const fetchStub = createFetchStub(jsonResponse({ success: false }, 401));

    await expect(requestConversationToken(SETTINGS, fetchStub)).rejects.toThrow(/HEY_JARVIS_MOBILE_APP_ACCESS_TOKEN/);
  });

  it('explains a server that has no access token configured', async () => {
    const fetchStub = createFetchStub(jsonResponse({ success: false }, 503));

    await expect(requestConversationToken(SETTINGS, fetchStub)).rejects.toThrow(/not configured/);
  });

  it('explains an address that answers with something other than Jarvis', async () => {
    const fetchStub = createFetchStub(jsonResponse({}, 404));

    await expect(requestConversationToken(SETTINGS, fetchStub)).rejects.toThrow(/server URL/);
  });

  it('reports the status when the server fails for some other reason', async () => {
    const fetchStub = createFetchStub(jsonResponse({ success: false }, 500));

    await expect(requestConversationToken(SETTINGS, fetchStub)).rejects.toThrow(/HTTP 500/);
  });

  it('refuses a successful response that carries no token, rather than passing undefined on', async () => {
    const fetchStub = createFetchStub(jsonResponse({ success: true, data: { conversationId: 'conv_1' } }));

    await expect(requestConversationToken(SETTINGS, fetchStub)).rejects.toThrow(/without a conversation token/);
  });

  it('refuses a token that is an empty string', async () => {
    const fetchStub = createFetchStub(jsonResponse({ success: true, data: { token: '', conversationId: 'conv_1' } }));

    await expect(requestConversationToken(SETTINGS, fetchStub)).rejects.toThrow(/without a conversation token/);
  });
});
