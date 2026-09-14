import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { timingSafeEqual } from 'crypto';
import type { Request, Response, Router } from 'express';
import { extractErrorMessage } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

/**
 * Where the mobile app asks for the credential it needs to talk to Jarvis.
 *
 * The phone holds no ElevenLabs API key. An API key can read every conversation
 * the account has ever had and rewrite the agent, and an app on a phone is the
 * one place it cannot be kept secret — decompiling the bundle is enough. So the
 * key stays on this server, and the phone gets a WebRTC conversation token
 * instead: single conversation, single agent, and it expires on its own.
 */
export const CONVERSATION_TOKEN_PATH = '/api/voice/conversation-token';

/** The name the phone appears under in the ElevenLabs conversation history. */
const DEFAULT_PARTICIPANT_NAME = 'jarvis-mobile';

/**
 * What a caller gets back: exactly the two fields `@elevenlabs/react-native`
 * needs to open a session, and nothing about how they were obtained.
 */
export interface ConversationTokenResponse {
  token: string;
  conversationId: string;
}

/** Mints a token for one conversation with the Jarvis agent. */
export type ConversationTokenMinter = (participantName: string) => Promise<ConversationTokenResponse>;

/**
 * The shared secret the mobile app authenticates with.
 *
 * Deliberately separate from the Cloudflare Access service token that fronts the
 * tunnel: the same server also answers on the local network, where Access never
 * sees the request at all.
 */
function getMobileAppAccessToken(): string | undefined {
  return process.env.HEY_JARVIS_MOBILE_APP_ACCESS_TOKEN?.trim() || undefined;
}

/**
 * Compares two secrets without leaking, through how long the comparison took,
 * how many leading characters a guess got right.
 *
 * `timingSafeEqual` throws on a length mismatch, which would leak the length, so
 * the lengths are checked first and an unequal one is reported as a plain
 * mismatch. The length of a shared secret is not what an attacker is missing.
 */
function secretsMatch(presented: string, expected: string): boolean {
  const presentedBytes = Buffer.from(presented, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');

  if (presentedBytes.length !== expectedBytes.length) {
    return false;
  }

  return timingSafeEqual(presentedBytes, expectedBytes);
}

/** Pulls the bearer credential out of an Authorization header, if there is one. */
export function extractBearerToken(authorizationHeader: unknown): string | undefined {
  if (typeof authorizationHeader !== 'string') {
    return undefined;
  }

  const [scheme, ...rest] = authorizationHeader.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer') {
    return undefined;
  }

  return rest.join(' ').trim() || undefined;
}

/**
 * Asks ElevenLabs for a WebRTC conversation token for the Jarvis agent.
 *
 * WebRTC rather than a signed WebSocket URL because that is the only transport
 * `@elevenlabs/react-native` supports — it throws outright on `signedUrl`, since
 * a WebSocket session needs Web Audio APIs that React Native does not have.
 */
export const mintConversationToken: ConversationTokenMinter = async (participantName) => {
  const apiKey = process.env.HEY_JARVIS_ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('ElevenLabs API key not configured. Set HEY_JARVIS_ELEVENLABS_API_KEY environment variable.');
  }

  const agentId = process.env.HEY_JARVIS_ELEVENLABS_AGENT_ID;
  if (!agentId) {
    throw new Error('ElevenLabs agent ID not configured. Set HEY_JARVIS_ELEVENLABS_AGENT_ID environment variable.');
  }

  const client = new ElevenLabsClient({ apiKey });
  const { token, conversationId } = await client.conversationalAi.conversations.getWebrtcToken({
    agentId,
    participantName,
  });

  return { token, conversationId };
};

/**
 * Builds the handler behind {@link CONVERSATION_TOKEN_PATH}.
 *
 * @param mintToken - How to obtain a token. Injectable so the tests can exercise
 *   the authentication and error paths without an ElevenLabs account.
 */
export function createConversationTokenHandler(
  mintToken: ConversationTokenMinter = mintConversationToken,
): (req: Request, res: Response) => void {
  return (req: Request, res: Response): void => {
    void (async (): Promise<void> => {
      const expectedToken = getMobileAppAccessToken();

      // An unconfigured secret is not an open door. Minting tokens for anyone who
      // finds the port would hand them a live microphone into the house.
      if (!expectedToken) {
        logger.error('[API] Conversation token requested but no mobile app access token is configured');
        res.status(503).json({
          success: false,
          message:
            'Conversation tokens are not available because HEY_JARVIS_MOBILE_APP_ACCESS_TOKEN is not configured on the server.',
        });
        return;
      }

      const presentedToken = extractBearerToken(req.headers.authorization);
      if (!presentedToken || !secretsMatch(presentedToken, expectedToken)) {
        logger.warn('[API] Rejected a conversation token request with a missing or wrong bearer token');
        res.status(401).json({
          success: false,
          message: 'A valid bearer token is required.',
        });
        return;
      }

      const requestedName: unknown = (req.body as Record<string, unknown> | undefined)?.participantName;
      const participantName =
        typeof requestedName === 'string' && requestedName.trim() ? requestedName.trim() : DEFAULT_PARTICIPANT_NAME;

      try {
        const { token, conversationId } = await mintToken(participantName);

        logger.info('[API] Minted a conversation token', { participantName, conversationId });

        res.json({
          success: true,
          message: 'Conversation token issued successfully',
          data: { token, conversationId } satisfies ConversationTokenResponse,
        });
      } catch (error: unknown) {
        const errorMessage = extractErrorMessage(error) ?? 'Unknown error';

        logger.error('[API] Failed to mint a conversation token', { error });

        res.status(500).json({
          success: false,
          message: 'Failed to mint a conversation token',
          error: errorMessage,
        });
      }
    })();
  };
}

/** Registers {@link CONVERSATION_TOKEN_PATH} on the given router. */
export function registerConversationTokenRoute(router: Router): string {
  router.post(CONVERSATION_TOKEN_PATH, createConversationTokenHandler());
  logger.info('[API] Registered conversation token endpoint', {
    method: 'POST',
    path: CONVERSATION_TOKEN_PATH,
  });
  return CONVERSATION_TOKEN_PATH;
}
