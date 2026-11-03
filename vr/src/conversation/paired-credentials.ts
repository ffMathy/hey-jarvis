import { type ConversationCredentials, HEADSET_PARTICIPANT_NAME } from 'hologram';

/**
 * A conversation's credential asked of sir's Jarvis server, by a headset paired with it, rather than
 * of ElevenLabs with a key the headset holds.
 *
 * The server holds the ElevenLabs key and asks on the headset's behalf (`verticals/api/paired-devices.ts`
 * in `mcp`). Its conversation endpoint bypasses Cloudflare Access, and the headset's own token is
 * what lets it in, so it keeps working however long Access's session lasts: the headset signs in to
 * Access once, to pair, and never again.
 */

/** Where a paired device asks for a conversation: `PAIRED_CONVERSATION_ROUTE` in `mcp`. */
export const PAIRED_CONVERSATION_PATH = '/api/paired/conversation';

/** The server could not be reached at all, in words for somebody wearing the headset. */
export const SERVER_UNREACHABLE_PROBLEM =
  'Your Jarvis server could not be reached. Check that the headset is online and the server is up.';

/** The server no longer knows this headset: it was unpaired, or the server lost its pairings. */
export const NO_LONGER_PAIRED_PROBLEM =
  'This headset is no longer paired with your Jarvis server. Pair it again on the page.';

/** Where the headset's server is, and the token it was paired with. */
export interface Pairing {
  address: string;
  deviceToken: string;
}

/** The message a refusal carries, when it carries one as the server writes them. */
async function refusalMessage(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string') {
      return body.message;
    }
  } catch {
    // A body that is not JSON says nothing more than the status does.
  }
  return undefined;
}

/** Narrows the server's answer to the one field asked for. */
function credentialIn(body: unknown, field: 'token' | 'signedUrl'): string | undefined {
  if (typeof body !== 'object' || body === null || !('data' in body)) return undefined;
  const { data } = body;
  if (typeof data !== 'object' || data === null || !(field in data)) return undefined;
  const value: unknown = Reflect.get(data, field);
  return typeof value === 'string' && value ? value : undefined;
}

async function ask(
  { address, deviceToken }: Pairing,
  request: { transport: 'webrtc' | 'websocket'; participantName: string },
  field: 'token' | 'signedUrl',
  fetchImplementation: typeof fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImplementation(`${address}${PAIRED_CONVERSATION_PATH}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${deviceToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  } catch (error) {
    throw new Error(SERVER_UNREACHABLE_PROBLEM, { cause: error });
  }
  if (response.status === 401) throw new Error(NO_LONGER_PAIRED_PROBLEM);
  if (!response.ok) {
    throw new Error(
      (await refusalMessage(response)) ??
        `Your Jarvis server could not start a conversation (HTTP ${response.status}).`,
    );
  }
  const credential = credentialIn(await response.json(), field);
  if (credential === undefined) throw new Error('Your Jarvis server answered without a conversation credential.');
  if (field === 'signedUrl' && !credential.startsWith('wss://')) {
    throw new Error('Your Jarvis server answered with a conversation address that is not wss://.');
  }
  return credential;
}

/** Credentials asked of the server the headset is paired with. */
export function pairedCredentials(pairing: Pairing): ConversationCredentials {
  return {
    token: (participantName, fetchImplementation = fetch) =>
      ask(pairing, { transport: 'webrtc', participantName }, 'token', fetchImplementation),
    signedUrl: (fetchImplementation = fetch) =>
      // ElevenLabs names no participant on a signed URL; the server asks the same way, and is told
      // the headset's name only because every request names its device.
      ask(
        pairing,
        { transport: 'websocket', participantName: HEADSET_PARTICIPANT_NAME },
        'signedUrl',
        fetchImplementation,
      ),
  };
}
