import { type Auth, google } from 'googleapis';

type OAuth2Client = Auth.OAuth2Client;

import { getCredentialsStorage } from '../storage/index.js';
import { logger } from '../utils/logger.js';

/**
 * The client last built, and the refresh token it was built with.
 *
 * A client built from a refresh token alone holds no access token, so its first request is a
 * token refresh against Google before the call it was made for. Building one per tool call paid
 * that on every calendar and task lookup; reusing it lets the client keep its access token and
 * refresh only as it nears expiry. It is keyed by the refresh token so that a new one -- minted
 * with `generate-tokens`, or rotated by Google and written back below -- takes effect on the next
 * call, just as it did when every call built its own client.
 */
let cachedClient: { refreshToken: string; client: OAuth2Client } | undefined;

/**
 * Creates and configures a Google OAuth2 client for Google API access, reusing the last one for
 * as long as the refresh token is unchanged.
 *
 * The client automatically refreshes access tokens using the stored refresh token.
 * Refresh tokens are long-lived (6+ months with regular use) and only need to be
 * obtained once using the `bun run --cwd mcp generate-tokens` command.
 *
 * Credentials are loaded in this order:
 * 1. Environment variables (HEY_JARVIS_GOOGLE_*)
 * 2. Mastra storage (oauth_credentials table)
 *
 * The scopes a client may use are fixed when its refresh token is minted, so
 * adopting a new Google API in a vertical also means adding that API's scope to
 * `googleProvider` and re-running `generate-tokens`.
 *
 * @throws {Error} If credentials are not found in either location
 */
export const getGoogleAuth = async (): Promise<OAuth2Client> => {
  const clientId = process.env.HEY_JARVIS_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.HEY_JARVIS_GOOGLE_CLIENT_SECRET;
  let refreshToken = process.env.HEY_JARVIS_GOOGLE_REFRESH_TOKEN;

  // Fallback to Mastra storage for refresh token only
  if (!refreshToken) {
    const credentialsStorage = await getCredentialsStorage();
    refreshToken = (await credentialsStorage.getRefreshToken('google')) ?? undefined;
  }

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing required Google OAuth2 credentials.\n' +
        '\n' +
        'Option 1: Set environment variables:\n' +
        '  - HEY_JARVIS_GOOGLE_CLIENT_ID\n' +
        '  - HEY_JARVIS_GOOGLE_CLIENT_SECRET\n' +
        '  - HEY_JARVIS_GOOGLE_REFRESH_TOKEN\n' +
        '\n' +
        'Option 2: Store refresh token in Mastra (client ID/secret still required in env):\n' +
        '  Run `bun run --cwd mcp generate-tokens`',
    );
  }

  if (cachedClient?.refreshToken === refreshToken) {
    return cachedClient.client;
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  // Listen for token refresh events and update storage automatically
  oauth2Client.on('tokens', (tokens) => {
    const renewedRefreshToken = tokens.refresh_token;
    if (renewedRefreshToken) {
      // OAuth provider has issued a new refresh token - update storage
      logger.info('New refresh token received from Google - updating storage');
      void (async () => {
        try {
          const credentialsStorage = await getCredentialsStorage();
          await credentialsStorage.renewRefreshToken('google', renewedRefreshToken);
          logger.info('Refresh token updated in storage');
        } catch (error: unknown) {
          logger.error('Failed to update refresh token in storage', { error });
        }
      })();
    }
    // Access token refresh is automatic and expected - no logging needed for normal operation
  });

  cachedClient = { refreshToken, client: oauth2Client };
  return oauth2Client;
};
