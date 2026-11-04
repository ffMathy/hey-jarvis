import * as Linking from 'expo-linking';
import { parseJarvisServerAddress } from 'hologram';
import { phonePairingUrl } from './jarvis-server';
import type { PairWithServer } from './platform-contracts';

/**
 * Pairs the phone app by opening the server's pairing page in the phone's browser, where Cloudflare
 * Access signs sir in and the page's button pairs the phone. A native app holds no Access cookie, so
 * it cannot send the pairing request itself; the token comes back on `heyjarvis://paired#token=…`,
 * which `app.tsx` reads. See "Pairing the phone app" in `jarvis-server.ts`.
 *
 * The address is remembered first, so the token that comes back — with no server named in it — is
 * kept beside the server whose page gave it, even if the app was stopped while the browser was up.
 */
export const pairWithServer: PairWithServer = async (typedAddress, rememberAddress) => {
  const parsed = parseJarvisServerAddress(typedAddress);
  if ('problem' in parsed) return { problem: parsed.problem };
  const { address } = parsed;
  if (address === undefined) return { problem: "Enter your Jarvis server's address." };

  rememberAddress(address);
  const page = phonePairingUrl(address);
  try {
    await Linking.openURL(page);
  } catch {
    return { problem: `This phone could not open its browser. Open ${page} in it, and press Pair there.` };
  }
  return { inTheBrowser: true };
};
