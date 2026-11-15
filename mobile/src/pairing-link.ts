import { parseStoredDeviceToken } from 'hologram';

/**
 * Pairing the phone app with the server, which a browser does with `pairWithServer` instead.
 *
 * Kept apart from `jarvis-server.ts`, which reads the keystore: these are pure, so the contract spec
 * that holds them to the server can import them without React Native. Importing them through
 * `jarvis-server.ts` loaded `expo-secure-store`, and with it React Native's Flow source, whenever that
 * spec ran before one that had mocked the store.
 *
 * **Through the browser, once.** A native app holds no Cloudflare Access cookie, so the app opens
 * the server's pairing page ({@link phonePairingUrl}) in the phone's browser, where Access signs sir
 * in as it does any page. Its button pairs the phone, and the page sends the browser on to this
 * app's own link, `heyjarvis://paired#token=…`, which the app reads ({@link pairedTokenFromLink})
 * and keeps beside the address it opened the page for. The server never sends a token anywhere but
 * this app's scheme, whatever asked.
 *
 * **Then never again.** Every conversation is asked of the server with the token, and the line
 * opens on the paired path with it in its hello. Unpairing the phone on the server ends both — for
 * the watch too, which holds the same token.
 */

/** The server's pairing page for the phone app: `PHONE_PAIRING_ROUTE` in `mcp`. */
export const PHONE_PAIRING_PATH = '/api/devices/pair';

/** The link the pairing page opens this app with: `PHONE_APP_PAIRED_URL` in `mcp`. */
export const PAIRED_LINK = 'heyjarvis://paired';

/** The page to open in the browser to pair this phone with the server at `address`. */
export function phonePairingUrl(address: string): string {
  return `${address}${PHONE_PAIRING_PATH}`;
}

/**
 * The token in the link the pairing page opened the app with, or `undefined` for any other link.
 *
 * Read by hand rather than with `URL`, since React Native's `URL` and `URLSearchParams` cannot read
 * one. The token is base64url, so the server's `URLSearchParams` wrote it as it is.
 */
export function pairedTokenFromLink(link: string | null | undefined): string | undefined {
  if (!link?.toLowerCase().startsWith(`${PAIRED_LINK}#`)) return undefined;
  const fragment = link.slice(PAIRED_LINK.length + 1);
  for (const part of fragment.split('&')) {
    const [name, value] = part.split('=');
    if (name === 'token') return parseStoredDeviceToken(value);
  }
  return undefined;
}
