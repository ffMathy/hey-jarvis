import { pairWithServer as pairThisBrowser, serverSignInUrl } from 'hologram';
import type { PairWithServer } from './platform-contracts';

/** What this browser is listed as among the server's paired devices. */
export const WEB_APP_DEVICE_NAME = 'Phone web app';

/**
 * Pairs the browser itself, with `hologram`'s `pairWithServer`, through Access's cookie — the way the
 * headset's page does, on the same origin, so a browser paired on either is paired on both. If the
 * server did not answer, what is offered is its sign-in, and then pairing again.
 *
 * The address needs no remembering ahead of time: it comes back in the pairing, with the token.
 */
export const pairWithServer: PairWithServer = async (typedAddress) => {
  const result = await pairThisBrowser(typedAddress, WEB_APP_DEVICE_NAME, fetch);
  if ('pairing' in result) return { paired: result.pairing };
  return result.signIn === undefined
    ? { problem: result.problem }
    : { problem: result.problem, signIn: serverSignInUrl(result.signIn) };
};
