import type { ElevenLabsSettings } from './elevenlabs-settings';

/** The ElevenLabs endpoint that mints a WebRTC token for one conversation with an agent. */
export const CONVERSATION_TOKEN_URL = 'https://api.elevenlabs.io/v1/convai/conversation/token';

/** What `@elevenlabs/react-native` needs in order to open a WebRTC session. */
export interface ConversationToken {
  token: string;
  conversationId: string;
}

/**
 * What each device calls itself in the ElevenLabs conversation history.
 *
 * Both names live here rather than in the app that uses them, because the point of them is to be
 * told apart: a conversation held on the wrist should be distinguishable in the history from one
 * held on the phone, from one held through the house speakers, and from one held over the phone
 * line. Two apps each naming themselves would drift into two names for the same thing.
 */
export const PHONE_PARTICIPANT_NAME = 'jarvis-android';
export const WATCH_PARTICIPANT_NAME = 'jarvis-wear';

/** Everything one conversation needs before it can be asked for: whose agent, and who is asking. */
export interface ConversationRequest {
  /** The API key to ask with, and the agent to ask for. */
  settings: ElevenLabsSettings;
  /** Which device this is — one of the two names above. Required, so neither app can borrow the other's. */
  participantName: string;
}

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
 * The machine-readable reason ElevenLabs gives for a failure, if it gives one.
 *
 * Only `detail.status` and `detail.code` are read, and only when they look like
 * the identifiers they are — `invalid_api_key`, `missing_permissions` — because
 * those are fixed values. The free-text message beside them is never read: it
 * can echo the request, and the request carried the API key.
 */
function readFailureReason(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null || !('detail' in payload)) {
    return undefined;
  }

  const { detail } = payload;
  if (typeof detail !== 'object' || detail === null) {
    return undefined;
  }

  const status = 'status' in detail ? detail.status : undefined;
  const code = 'code' in detail ? detail.code : undefined;
  for (const candidate of [status, code]) {
    if (typeof candidate === 'string' && /^[a-z_]{3,64}$/.test(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

/** Reasons ElevenLabs gives for each kind of failure, as far as they are known. */
const REJECTED_KEY_REASONS = ['invalid_api_key', 'missing_api_key'];
const MISSING_PERMISSION_REASONS = ['missing_permissions', 'insufficient_permissions'];
const UNKNOWN_AGENT_REASONS = ['invalid_agent_id', 'agent_not_found', 'document_not_found'];
const NO_CREDIT_REASONS = ['insufficient_credits', 'quota_exceeded'];

/**
 * Explains an unsuccessful response in terms of what the user can do about it,
 * because each failure has a different fix and "request failed" points at none.
 *
 * The reason ElevenLabs names wins over the status code, since one status covers
 * several fixes — a 401 is a wrong key, but also a right key without permission.
 * The response body itself is never shown (see {@link readFailureReason}).
 */
function describeFailure(status: number, reason: string | undefined): string {
  if (reason && MISSING_PERMISSION_REASONS.includes(reason)) {
    return 'The API key is not allowed to start conversations. Give it access to the agents platform, or use another key.';
  }

  if (reason === 'detected_unusual_activity') {
    return 'ElevenLabs has restricted this account. Sign in to ElevenLabs to see why.';
  }

  if ((reason && UNKNOWN_AGENT_REASONS.includes(reason)) || status === 404) {
    return 'ElevenLabs has no agent with that ID on this account. Check the agent ID in the settings.';
  }

  if ((reason && NO_CREDIT_REASONS.includes(reason)) || status === 402) {
    return 'The ElevenLabs account has run out of credits.';
  }

  if ((reason && REJECTED_KEY_REASONS.includes(reason)) || status === 401) {
    return 'ElevenLabs rejected the API key. Check it in the settings.';
  }

  if (status === 403) {
    return 'The API key is not allowed to start conversations. Give it access to the agents platform, or use another key.';
  }

  if (status === 429) {
    return 'ElevenLabs is busy with too many conversations on this account. Try again shortly.';
  }

  return `ElevenLabs could not start a conversation (HTTP ${status}).`;
}

/** Reads an error body for its reason, treating anything unreadable as no reason. */
async function failureReason(response: Response): Promise<string | undefined> {
  try {
    return readFailureReason(await response.json());
  } catch {
    return undefined;
  }
}

/**
 * Asks ElevenLabs for a token for one conversation with the Jarvis agent.
 *
 * WebRTC, because that is the only transport `@elevenlabs/react-native`
 * supports: it throws outright on a signed WebSocket URL.
 *
 * @param request - Whose agent to ask for, and which device is asking.
 * @param fetchImplementation - Injectable so the tests can exercise every failure
 *   path without an ElevenLabs account.
 */
export async function requestConversationToken(
  { settings, participantName }: ConversationRequest,
  fetchImplementation: typeof fetch = fetch,
): Promise<ConversationToken> {
  const query = new URLSearchParams({ agent_id: settings.agentId, participant_name: participantName });

  const response = await fetchImplementation(`${CONVERSATION_TOKEN_URL}?${query}`, {
    method: 'GET',
    headers: { 'xi-api-key': settings.apiKey },
  });

  if (!response.ok) {
    throw new Error(describeFailure(response.status, await failureReason(response)));
  }

  const token = readToken(await response.json());
  if (!token) {
    throw new Error('ElevenLabs answered without a conversation token.');
  }

  return token;
}
