import { JARVIS_SERVER_ADDRESS_STORAGE_KEY, parseJarvisServerAddress } from 'hologram';
import type { Pairing } from '../conversation/paired-credentials';
import type { KeyValueStorage } from './settings';

/**
 * Pairing the headset with sir's Jarvis server, so that the server starts its conversations and no
 * ElevenLabs key has to be typed on a virtual keyboard or kept in this browser's storage.
 *
 * **Once, through Cloudflare Access.** Pairing is the one request that has to prove who is asking.
 * The page sends it with the browser's cookies, so Access's `CF_Authorization` cookie for the server
 * — set when sir signs in to the server in this browser, which the live line asks for anyway — goes
 * with it. It is sent as plain text with no headers of its own, which makes it a request the browser
 * sends without a preflight: a preflight carries no cookie, and Access would answer it with its
 * login page.
 *
 * **Then never again.** The server answers with a token of its own for this headset, kept here and
 * sent with every conversation request to the one path Access lets through (see
 * `paired-credentials.ts`). Losing the headset means unpairing it on the server, not revoking a key.
 */

/** Where the token is kept. Only the headset's page pairs, so the phone's web build never reads it. */
export const DEVICE_TOKEN_STORAGE_KEY = 'jarvis.headset-device-token';

/** Where the headset is paired: `DEVICE_PAIRING_PATH` in `mcp`. */
export const DEVICE_PAIRING_PATH = '/api/devices';

/** What the headset is listed as among the server's paired devices. */
export const HEADSET_DEVICE_NAME = 'Meta Quest headset';

/** What a pairing that reached no server is told, with the way out the page then offers. */
export const SIGN_IN_FIRST =
  'The server did not answer. If Cloudflare Access is in front of it, sign in to it in this browser below, then pair again.';

/** The pairing kept on this page, or nothing when the headset has not been paired, or storage throws. */
export function loadPairing(storage: KeyValueStorage): Pairing | undefined {
  try {
    const parsed = parseJarvisServerAddress(storage.getItem(JARVIS_SERVER_ADDRESS_STORAGE_KEY) ?? '');
    const deviceToken = storage.getItem(DEVICE_TOKEN_STORAGE_KEY);
    if (!('address' in parsed) || parsed.address === undefined || !deviceToken) return undefined;
    return { address: parsed.address, deviceToken };
  } catch {
    return undefined;
  }
}

/** Keeps a pairing: the address where the phone's web build keeps it, and the token beside it. */
export function savePairing(storage: KeyValueStorage, { address, deviceToken }: Pairing): string | undefined {
  try {
    storage.setItem(JARVIS_SERVER_ADDRESS_STORAGE_KEY, address);
    storage.setItem(DEVICE_TOKEN_STORAGE_KEY, deviceToken);
    return undefined;
  } catch {
    return 'This browser would not keep the pairing. Check that it allows this site to store data.';
  }
}

/** Reads the token out of the server's answer, without trusting its shape. */
function tokenIn(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('data' in body)) return undefined;
  const { data } = body;
  if (typeof data !== 'object' || data === null || !('token' in data)) return undefined;
  const { token } = data;
  return typeof token === 'string' && /^[A-Za-z0-9_-]{20,128}$/.test(token) ? token : undefined;
}

/**
 * Pairs the headset with the server at what was typed, or says why it could not.
 *
 * `signIn` is the address to sign in at when the request reached no answer the page could read —
 * which is what Access's login looks like from here, since it answers without the CORS headers the
 * browser needs to show the page anything.
 */
export async function pairWithServer(
  typedAddress: string,
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
      body: HEADSET_DEVICE_NAME,
    });
  } catch {
    return { problem: SIGN_IN_FIRST, signIn: address };
  }
  if (!response.ok) {
    return { problem: `Your Jarvis server would not pair this headset (HTTP ${response.status}).` };
  }
  const deviceToken = tokenIn(await response.json().catch(() => undefined));
  if (deviceToken === undefined) return { problem: 'Your Jarvis server answered without a token for this headset.' };
  return { pairing: { address, deviceToken } };
}
