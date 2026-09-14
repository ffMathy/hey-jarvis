import type { ServerSettings } from './server-settings';

/** The path the Jarvis MCP server answers conversation token requests on. */
export const CONVERSATION_TOKEN_PATH = '/api/voice/conversation-token';

/** What `@elevenlabs/react-native` needs in order to open a WebRTC session. */
export interface ConversationToken {
  token: string;
  conversationId: string;
}

/**
 * The name this phone appears under in the ElevenLabs conversation history, so a
 * conversation held here is distinguishable from one held through the house
 * speakers or over the phone line.
 */
export const MOBILE_PARTICIPANT_NAME = 'jarvis-android';

/** Narrows the server's response envelope without trusting its shape. */
function readToken(payload: unknown): ConversationToken | undefined {
  if (typeof payload !== 'object' || payload === null || !('data' in payload)) {
    return undefined;
  }

  const { data } = payload;
  if (typeof data !== 'object' || data === null || !('token' in data) || !('conversationId' in data)) {
    return undefined;
  }

  const { token, conversationId } = data;
  if (typeof token !== 'string' || !token || typeof conversationId !== 'string') {
    return undefined;
  }

  return { token, conversationId };
}

/**
 * Explains an unsuccessful response in terms of what the user can do about it,
 * because every one of these failures has a different fix and "request failed"
 * points at none of them.
 */
function describeFailure(status: number): string {
  if (status === 401) {
    return 'Jarvis rejected the access token. Check it against HEY_JARVIS_MOBILE_APP_ACCESS_TOKEN on the server.';
  }

  if (status === 503) {
    return 'Jarvis is not configured to hand out conversation tokens. Set HEY_JARVIS_MOBILE_APP_ACCESS_TOKEN on the server.';
  }

  if (status === 404) {
    return 'That address answered, but not with Jarvis. Check the server URL.';
  }

  return `Jarvis could not start a conversation (HTTP ${status}).`;
}

/**
 * Asks the Jarvis server for a token for one conversation.
 *
 * @param settings - Where the server is and what to authenticate with.
 * @param fetchImplementation - Injectable so the tests can exercise every failure
 *   path without a server.
 */
export async function requestConversationToken(
  settings: ServerSettings,
  fetchImplementation: typeof fetch = fetch,
): Promise<ConversationToken> {
  const response = await fetchImplementation(`${settings.serverUrl}${CONVERSATION_TOKEN_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${settings.accessToken}`,
    },
    body: JSON.stringify({ participantName: MOBILE_PARTICIPANT_NAME }),
  });

  if (!response.ok) {
    throw new Error(describeFailure(response.status));
  }

  const token = readToken(await response.json());
  if (!token) {
    throw new Error('Jarvis answered without a conversation token.');
  }

  return token;
}
