/**
 * The Jarvis server's address, as sir types it on the phone: where a device reaches the server's
 * own APIs — the photo routes over REST, and the WebSocket API every device that is Jarvis keeps
 * open for as long as its app runs (`jarvis-server-link.ts`).
 *
 * Here rather than in the phone app because three apps read it: the phone types and keeps it, hands
 * it to the watch with the ElevenLabs settings, and the headset's page reads it from the
 * `localStorage` it shares with the phone's web build.
 *
 * **An origin, and nothing more.** A device puts the server's own paths after it, and never a URL
 * from anywhere else, so an address with a path, a query or a user name in it is refused rather than
 * half-used. `https`, because the app allows no cleartext traffic on a phone — and so `http` only
 * for this very computer, where a browser build is tried against a server running beside it.
 *
 * **Not a secret.** The address is an address and nothing else. What may reach the server is for
 * the Cloudflare Zero Trust application in front of it to decide, and the service token that
 * application accepts is kept apart (see {@link JARVIS_SERVER_SERVICE_TOKEN_STORAGE_KEY}).
 */

/** Where the address is kept, in whatever key-value store the device has. */
export const JARVIS_SERVER_ADDRESS_STORAGE_KEY = 'jarvis.server-address';

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
 * A Cloudflare Access service token: the pair Zero Trust hands out under Access → Service Auth, sent
 * with every connection to the server (see `jarvis-server-link.ts`) so the Access application in
 * front of it lets a device through.
 *
 * **A service token rather than a sign-in's JWT**, because a device has no browser to sign in with
 * and a JWT lasts only as long as the application's session — a day by default — after which the
 * line was refused until sir pasted a new one. A service token lasts until it is revoked, can be
 * revoked on its own, and is what ElevenLabs reaches the same server with.
 */
export interface JarvisServerServiceToken {
  readonly clientId: string;
  readonly clientSecret: string;
}

/**
 * Where the service token is kept, beside the address. Unlike the address it is a credential, so it
 * is kept as the ElevenLabs key is — the keystore on a phone — and never shown once saved.
 */
export const JARVIS_SERVER_SERVICE_TOKEN_STORAGE_KEY = 'jarvis.server-service-token';

/** How a service token's Client ID ends: Cloudflare mints every one as `<id>.access`. */
const CLIENT_ID_SUFFIX = '.access';

/**
 * Turns the Client ID and Client Secret sir typed into the service token to send, or explains why
 * they cannot be one.
 *
 * Both left empty is a valid answer: a server with nothing in front of it needs no token. The
 * whitespace a paste picks up is forgiven; one without the other, a space inside either, and a
 * Client ID that is not one — the secret pasted into it, say — are refused here rather than at
 * Cloudflare, which would only answer with a refused socket.
 */
export function parseJarvisServerServiceToken(
  typedClientId: string,
  typedClientSecret: string,
): { serviceToken: JarvisServerServiceToken | undefined } | { problem: string } {
  const clientId = typedClientId.trim();
  const clientSecret = typedClientSecret.trim();
  if (!clientId && !clientSecret) {
    return { serviceToken: undefined };
  }
  if (!clientId || !clientSecret) {
    return { problem: 'The service token needs both its Client ID and its Client Secret.' };
  }
  if (/\s/.test(clientId) || /\s/.test(clientSecret)) {
    return { problem: 'The service token has a space in it. Paste just the Client ID and the Client Secret.' };
  }
  if (!clientId.endsWith(CLIENT_ID_SUFFIX) || clientId.length === CLIENT_ID_SUFFIX.length) {
    return { problem: 'The Client ID should end in .access, like 1a2b3c….access.' };
  }
  return { serviceToken: { clientId, clientSecret } };
}
