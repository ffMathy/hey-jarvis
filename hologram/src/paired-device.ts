import type { ConversationCredentials } from './conversation-token';
import { HEADSET_PARTICIPANT_NAME } from './conversation-token';
import { parseJarvisServerAddress } from './jarvis-server-address';

/**
 * Pairing a device with sir's Jarvis server, which is the only way any device gets a conversation:
 * the server holds the ElevenLabs key and starts each conversation on the device's behalf, so no key
 * is typed in or kept on a phone, a watch or in a browser — and the device's line to the server
 * needs no Cloudflare Access cookie or service token, both of which run out or have to be pasted.
 *
 * The headset's page (`vr/`) and the phone app's web build (`mobile/`, on web) are served from the
 * same origin, so they share `localStorage`, and a browser paired on one of them is paired on both.
 *
 * **Once, through Cloudflare Access.** Pairing is the one request that has to prove who is asking.
 * It is sent with the browser's cookies, so Access's `CF_Authorization` cookie for the server goes
 * with it, and as plain text with no headers of its own, which makes it a request the browser sends
 * without a preflight: a preflight carries no cookie, and Access would answer it with its login page.
 * The server's side is `verticals/api/paired-devices.ts` in `mcp`.
 *
 * **Then never again.** The server answers with a token of its own for the browser, kept under
 * {@link JARVIS_DEVICE_TOKEN_STORAGE_KEY} and sent with every conversation request
 * ({@link pairedCredentials}) and in the hello of the line (`deviceToken` in `connectToServer`), both
 * on paths Access lets through, where the server checks the token itself.
 */

/** Where a device keeps the token it was paired with, beside the server's address. */
export const JARVIS_DEVICE_TOKEN_STORAGE_KEY = 'jarvis.device-token';

/** Where a browser is paired: `DEVICE_PAIRING_PATH` in `mcp`. */
export const DEVICE_PAIRING_PATH = '/api/devices';

/** Where a paired device asks for a conversation: `PAIRED_CONVERSATION_ROUTE` in `mcp`. */
export const PAIRED_CONVERSATION_PATH = '/api/paired/conversation';

/** Where the server is, and the token the browser was paired with. */
export interface Pairing {
  address: string;
  deviceToken: string;
}

/** What a device token looks like: 256 random bits in base64url, or near enough to let through. */
const DEVICE_TOKEN = /^[A-Za-z0-9_-]{20,128}$/;

/** A token as it came out of storage, or `undefined` for nothing that could be one. */
export function parseStoredDeviceToken(stored: string | null | undefined): string | undefined {
  return stored && DEVICE_TOKEN.test(stored) ? stored : undefined;
}

/**
 * Where a browser signs in to the server's Access application: the pairing path itself, so Access
 * sets its cookie for the application that pairing goes through. The server answers there with the
 * list of paired devices; the tab is done with once the login is.
 */
export function serverSignInUrl(address: string): string {
  return `${address}${DEVICE_PAIRING_PATH}`;
}

/** What a pairing that reached no server is told, beside the way to sign in it is offered. */
export const SIGN_IN_FIRST =
  'The server did not answer. If Cloudflare Access is in front of it, sign in to it in this browser, then pair again.';

/** Reads the token out of the server's answer, without trusting its shape. */
function tokenIn(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('data' in body)) return undefined;
  const { data } = body;
  if (typeof data !== 'object' || data === null || !('token' in data)) return undefined;
  const { token } = data;
  return typeof token === 'string' ? parseStoredDeviceToken(token) : undefined;
}

/**
 * Pairs the browser with the server at what was typed, under `deviceName`, or says why it could not.
 *
 * `signIn` is the server to sign in to when the request reached no answer the page could read —
 * which is what Access's login looks like from a page, since it answers without the CORS headers the
 * browser needs to show the page anything.
 */
export async function pairWithServer(
  typedAddress: string,
  deviceName: string,
  fetchImplementation: typeof fetch,
): Promise<{ pairing: Pairing } | { problem: string; signIn?: string }> {
  const parsed = parseJarvisServerAddress(typedAddress);
  if ('problem' in parsed) return { problem: parsed.problem };
  const { address } = parsed;
  if (address === undefined) return { problem: "Enter your Jarvis server's address." };

  let response: Response;
  try {
    response = await fetchImplementation(`${address}${DEVICE_PAIRING_PATH}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'text/plain' },
      body: deviceName,
    });
  } catch {
    return { problem: SIGN_IN_FIRST, signIn: address };
  }
  if (!response.ok) {
    return { problem: `Your Jarvis server would not pair this browser (HTTP ${response.status}).` };
  }
  const deviceToken = tokenIn(await response.json().catch(() => undefined));
  if (deviceToken === undefined) return { problem: 'Your Jarvis server answered without a token for this browser.' };
  return { pairing: { address, deviceToken } };
}

/** The server could not be reached at all, in words for whoever is waiting for him. */
export const SERVER_UNREACHABLE_PROBLEM =
  'Your Jarvis server could not be reached. Check that this device is online and the server is up.';

/** The server no longer knows this device: it was unpaired, or the server lost its pairings. */
export const NO_LONGER_PAIRED_PROBLEM =
  'This device is no longer paired with your Jarvis server. Pair it again in the settings.';

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

/** A server process's id or a token's fingerprint, as the server writes them: 8 hex characters. */
const SHORT_HEX = /^[0-9a-f]{8}$/;

/** A refusal's reason, as the server writes them: a few plain words. */
const PLAIN_REASON = /^[A-Za-z ]{1,40}$/;

/** A field of the refusal's details, if it is a string that matches what it should be. */
function detailOf(details: object, field: string, shape: RegExp): string | undefined {
  const value: unknown = Reflect.get(details, field);
  return typeof value === 'string' && shape.test(value) ? value : undefined;
}

/**
 * What the server said about a token it did not know (`details` in `mcp`'s paired-device routes), in
 * words to show beside the problem: which server refused it, why, and the refused token's fingerprint.
 * Set beside the server's device list, they tell a token it never gave from a second server answering
 * on the same hostname, for whoever cannot read the server's log. Only fields of the shapes the
 * server writes are shown.
 */
async function refusalDetails(response: Response): Promise<string | undefined> {
  const body: unknown = await response.json().catch(() => undefined);
  if (typeof body !== 'object' || body === null || !('details' in body)) return undefined;
  const { details } = body;
  if (typeof details !== 'object' || details === null) return undefined;
  const server = detailOf(details, 'server', SHORT_HEX);
  if (server === undefined) return undefined;
  const reason = detailOf(details, 'reason', PLAIN_REASON);
  const token = detailOf(details, 'token', SHORT_HEX);
  if (reason === undefined) return `Server ${server}.`;
  return token === undefined ? `Server ${server}: ${reason}.` : `Server ${server}: ${reason} ${token}.`;
}

/** Narrows the server's answer to the one field asked for. */
function credentialIn(body: unknown, field: 'token' | 'signedUrl'): string | undefined {
  if (typeof body !== 'object' || body === null || !('data' in body)) return undefined;
  const { data } = body;
  if (typeof data !== 'object' || data === null || !(field in data)) return undefined;
  const value: unknown = Reflect.get(data, field);
  return typeof value === 'string' && value ? value : undefined;
}

async function askServer(
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
  if (response.status === 401) {
    const details = await refusalDetails(response);
    throw new Error(details === undefined ? NO_LONGER_PAIRED_PROBLEM : `${NO_LONGER_PAIRED_PROBLEM} (${details})`);
  }
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

/** Credentials asked of the server the device is paired with, which asks ElevenLabs for them. */
export function pairedCredentials(pairing: Pairing): ConversationCredentials {
  return {
    token: (participantName, fetchImplementation = fetch) =>
      askServer(pairing, { transport: 'webrtc', participantName }, 'token', fetchImplementation),
    signedUrl: (fetchImplementation = fetch) =>
      // ElevenLabs names no participant on a signed URL; the server asks the same way, and is told a
      // name only because every request names its device, and only a device's name is accepted.
      askServer(
        pairing,
        { transport: 'websocket', participantName: HEADSET_PARTICIPANT_NAME },
        'signedUrl',
        fetchImplementation,
      ),
  };
}
