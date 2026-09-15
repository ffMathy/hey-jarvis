import type { ElevenLabsSettings } from './elevenlabs-settings';

/** The ElevenLabs endpoint that mints a WebRTC token for one conversation with an agent. */
export const CONVERSATION_TOKEN_URL = 'https://api.elevenlabs.io/v1/convai/conversation/token';

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

/** Narrows ElevenLabs' response without trusting its shape. */
function readToken(payload: unknown): ConversationToken | undefined {
  if (typeof payload !== 'object' || payload === null || !('token' in payload)) {
    return undefined;
  }

  const { token } = payload;
  const conversationId = 'conversation_id' in payload ? payload.conversation_id : undefined;
  if (typeof token !== 'string' || !token || typeof conversationId !== 'string') {
    return undefined;
  }

  return { token, conversationId };
}

/**
 * Explains an unsuccessful response in terms of what the user can do about it,
 * because each failure has a different fix and "request failed" points at none.
 *
 * Nothing from the response body is shown: it can echo the request, and the
 * request carried the API key.
 */
function describeFailure(status: number): string {
  if (status === 401) {
    return 'ElevenLabs rejected the API key. Check it in the settings.';
  }

  if (status === 403) {
    return 'The API key is not allowed to start conversations. Give it access to the agents platform, or use another key.';
  }

  if (status === 404 || status === 422) {
    return 'ElevenLabs has no agent with that ID on this account. Check the agent ID in the settings.';
  }

  if (status === 429) {
    return 'ElevenLabs is refusing requests for now — too many at once, or the account is out of credits.';
  }

  return `ElevenLabs could not start a conversation (HTTP ${status}).`;
}

/**
 * Asks ElevenLabs for a token for one conversation with the Jarvis agent.
 *
 * WebRTC, because that is the only transport `@elevenlabs/react-native`
 * supports: it throws outright on a signed WebSocket URL.
 *
 * @param settings - The API key to ask with, and the agent to ask for.
 * @param fetchImplementation - Injectable so the tests can exercise every failure
 *   path without an ElevenLabs account.
 */
export async function requestConversationToken(
  settings: ElevenLabsSettings,
  fetchImplementation: typeof fetch = fetch,
): Promise<ConversationToken> {
  const query = new URLSearchParams({ agent_id: settings.agentId, participant_name: MOBILE_PARTICIPANT_NAME });

  const response = await fetchImplementation(`${CONVERSATION_TOKEN_URL}?${query}`, {
    method: 'GET',
    headers: { 'xi-api-key': settings.apiKey },
  });

  if (!response.ok) {
    throw new Error(describeFailure(response.status));
  }

  const token = readToken(await response.json());
  if (!token) {
    throw new Error('ElevenLabs answered without a conversation token.');
  }

  return token;
}
