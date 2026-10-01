import { readStoredValue, writeStoredValue } from './key-value-store';

/**
 * The Jarvis server's address: where this phone sends sir's photos, and the one thing on it that
 * belongs to his own server rather than to ElevenLabs.
 *
 * **Optional, and only for photos.** Talking to Jarvis needs nothing but ElevenLabs, as it always
 * has, so a phone without an address talks to him exactly as before and simply offers no camera: no
 * button beside him, and nothing told to the agent about one (`use-photo-sending.ts`). With one, the
 * camera button asks the server for somewhere to send a photo, and sends it there — see "Showing him
 * something" in `mobile/AGENTS.md`.
 *
 * **No secret.** The server needs no key from the phone: it opens a slot for a photo only for a
 * conversation ElevenLabs confirms is live on Jarvis's agent, and the slot's unguessable name is all
 * the upload asks for. So this is an address and nothing else — kept like the settings, but shown as
 * typed, since there is nothing in it worth hiding.
 *
 * **An origin, and nothing more.** The phone puts the server's own paths after it, and never a URL
 * from anywhere else (`photo-upload.ts`), so an address with a path, a query or a user name in it is
 * refused rather than half-used. `https`, because the app allows no cleartext traffic on a phone —
 * and so `http` only for this very computer, where a browser build is tried against a server running
 * beside it.
 *
 * **Never the watch's.** It is not part of `ElevenLabsSettings`, which is what is handed across to
 * the watch and what the headset's page reads, and nothing sends it there: neither has a camera. It
 * is kept under a storage key of its own, so the two can be saved and read without either having to
 * know the other's shape.
 */

const STORAGE_KEY = 'jarvis.server-address';

/**
 * A host as an address can name one: DNS labels separated by dots, which an IPv4 address also is.
 *
 * A regular expression rather than `URL`, because React Native's `URL` implements none of the parts
 * an address would be read by — its `hostname`, `port` and `pathname` are not there to read.
 */
const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

/** What an address starts with when it names its scheme: letters, then `://`. */
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/s;

/** The hosts that are this very computer, the only ones `http` is accepted for. */
const THIS_COMPUTER = ['localhost', '127.0.0.1'];

/** The highest port there is. */
const LAST_PORT = 65_535;

/** The problem for anything that is not an address at all. */
const NOT_AN_ADDRESS = "The Jarvis server's address should look like https://jarvis.example.com.";

/**
 * The host and port after the scheme, or why there are not just those: a trailing slash is forgiven,
 * and anything else after the host — a path, a query, a fragment, a user name — is not.
 */
function readHostAndPort(afterScheme: string): { host: string; port: number | undefined } | { problem: string } {
  const authority = afterScheme.endsWith('/') ? afterScheme.slice(0, -1) : afterScheme;
  if (authority.includes('@')) {
    return { problem: "The Jarvis server's address takes no user name or password." };
  }
  if (/[/?#]/.test(authority)) {
    return {
      problem: "Give just the Jarvis server's address, with no path after it — like https://jarvis.example.com.",
    };
  }

  const [host = '', port, ...extra] = authority.split(':');
  if (extra.length > 0 || !HOST.test(host)) {
    return { problem: NOT_AN_ADDRESS };
  }
  if (port === undefined) {
    return { host: host.toLowerCase(), port: undefined };
  }
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > LAST_PORT) {
    return { problem: "The Jarvis server's port should be a number from 1 to 65535." };
  }
  return { host: host.toLowerCase(), port: Number(port) };
}

/**
 * Turns what was typed into the server's origin — `https://host` or `https://host:port`, in lower
 * case and with no slash at the end — or explains why it cannot be one.
 *
 * Nothing typed is a valid answer: it is how the camera is switched off, so an empty field is no
 * address rather than a problem. A bare host is taken to mean `https`, and the surrounding whitespace
 * and the trailing slash a paste or a browser's address bar leaves are forgiven.
 */
export function parseJarvisServerAddress(typed: string): { address: string | undefined } | { problem: string } {
  const trimmed = typed.trim();
  if (!trimmed) {
    return { address: undefined };
  }

  const withScheme = SCHEME.exec(trimmed);
  const scheme = (withScheme?.[1] ?? 'https').toLowerCase();
  if (scheme !== 'https' && scheme !== 'http') {
    return { problem: "The Jarvis server's address starts with https://." };
  }

  const hostAndPort = readHostAndPort(withScheme?.[2] ?? trimmed);
  if ('problem' in hostAndPort) {
    return hostAndPort;
  }
  const { host, port } = hostAndPort;
  if (scheme === 'http' && !THIS_COMPUTER.includes(host)) {
    return {
      problem:
        "The Jarvis server's address has to start with https://. Only this computer (localhost) can use http://.",
    };
  }
  return { address: `${scheme}://${host}${port === undefined ? '' : `:${port}`}` };
}

/**
 * What came back: an address, none kept, or a read that failed — the same three answers
 * `settings-storage.ts` gives, for the same reason.
 *
 * **A read that fails is not yet "no address".** It is read at the same moment as the settings, from
 * the same keystore, in a window the system has only just made — exactly the read that can throw
 * while the native module is still coming up. Folded into "none", one such throw would take the
 * camera away from a summoning of the assistant's window with the address in the keystore the whole
 * time. So `app.tsx` tries again, as it does for the settings (`read-again.ts`), and only an address
 * that still cannot be read is no address: the camera stays off, which is what failing closed means
 * here.
 */
export type StoredJarvisServerAddress =
  | { kind: 'address'; address: string }
  | { kind: 'nothing' }
  | { kind: 'unreadable' };

/**
 * Reads the stored address, saying which of the three things happened. A stored value is parsed again
 * on the way out, so nothing that could not have been saved is ever sent anything.
 */
export async function loadJarvisServerAddress(): Promise<StoredJarvisServerAddress> {
  let stored: string | undefined;
  try {
    stored = await readStoredValue(STORAGE_KEY);
  } catch {
    return { kind: 'unreadable' };
  }

  const parsed = parseJarvisServerAddress(stored ?? '');
  return 'address' in parsed && parsed.address !== undefined
    ? { kind: 'address', address: parsed.address }
    : { kind: 'nothing' };
}

/**
 * The settings screen changing the address: the one to keep instead, `undefined` for none.
 *
 * A save that leaves the field as it was is no change at all, and is reported as none rather than as
 * the field's value — see `elevenlabs-fields.tsx` for the address that would otherwise be erased.
 */
export interface JarvisServerAddressChange {
  address: string | undefined;
}

/**
 * Keeps the address, or forgets it. No address is stored as an empty string, which reads back as
 * none — the store has no way to delete an entry, and an empty one is what an unset field saves as.
 */
export async function saveJarvisServerAddress(address: string | undefined): Promise<void> {
  await writeStoredValue(STORAGE_KEY, address ?? '');
}
