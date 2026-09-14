/**
 * Where the phone finds Jarvis, and what it presents to prove it is allowed to.
 *
 * Neither value is baked into the app. The ElevenLabs API key never leaves the
 * server, and this access token is what the server checks before it will mint a
 * conversation token — see `mcp/mastra/verticals/api/conversation-token.ts`.
 */
export interface ServerSettings {
  /** Base URL of the Jarvis MCP server, with no trailing slash. */
  serverUrl: string;
  /** The value of `HEY_JARVIS_MOBILE_APP_ACCESS_TOKEN` on that server. */
  accessToken: string;
}

/**
 * Trims a typed-in URL and drops the trailing slash, so paths append cleanly.
 *
 * The scheme's own `//` is held back from the trimming. Without that, `https://`
 * normalises to `https:` and then fails the "must start with https://" check
 * rather than the "you forgot the host name" one, which is the half-typed
 * address the user actually has in front of them.
 */
export function normalizeServerUrl(rawServerUrl: string): string {
  const trimmed = rawServerUrl.trim();
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(trimmed)?.[0] ?? '';

  return scheme + trimmed.slice(scheme.length).replace(/\/+$/, '');
}

/**
 * Says what is wrong with a server URL, or nothing if it is usable.
 *
 * Plain HTTP is refused rather than merely discouraged. This connection carries
 * a credential that mints live microphone sessions, and the phone is on whatever
 * network it happens to be on; the Jarvis server is reachable over HTTPS through
 * its tunnel, so there is no case where cleartext is the only option.
 */
export function describeServerUrlProblem(rawServerUrl: string): string | undefined {
  const serverUrl = normalizeServerUrl(rawServerUrl);

  if (!serverUrl) {
    return 'Enter the address of your Jarvis server.';
  }

  if (serverUrl.startsWith('http://')) {
    return 'The address has to use https — the access token is sent with every request.';
  }

  if (!serverUrl.startsWith('https://')) {
    return 'The address has to start with https://.';
  }

  if (!serverUrl.slice('https://'.length).trim()) {
    return 'The address is missing a host name.';
  }

  return undefined;
}

/** Says what is wrong with an access token, or nothing if it is usable. */
export function describeAccessTokenProblem(rawAccessToken: string): string | undefined {
  if (!rawAccessToken.trim()) {
    return 'Enter the access token your Jarvis server was configured with.';
  }

  return undefined;
}

/**
 * Turns what was typed into settings the rest of the app can rely on, or
 * explains why it cannot.
 */
export function parseServerSettings(
  rawServerUrl: string,
  rawAccessToken: string,
): { settings: ServerSettings } | { problem: string } {
  const serverUrlProblem = describeServerUrlProblem(rawServerUrl);
  if (serverUrlProblem) {
    return { problem: serverUrlProblem };
  }

  const accessTokenProblem = describeAccessTokenProblem(rawAccessToken);
  if (accessTokenProblem) {
    return { problem: accessTokenProblem };
  }

  return {
    settings: {
      serverUrl: normalizeServerUrl(rawServerUrl),
      accessToken: rawAccessToken.trim(),
    },
  };
}
