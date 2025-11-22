import { type AuthorizationCodeRequest, ConfidentialClientApplication } from '@azure/msal-node';
import type { OAuthProvider, TokenResponse } from './types.js';

const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

export const microsoftProvider: OAuthProvider = {
  name: 'Microsoft',
  clientIdEnvVar: 'HEY_JARVIS_MICROSOFT_CLIENT_ID',
  clientSecretEnvVar: 'HEY_JARVIS_MICROSOFT_CLIENT_SECRET',
  refreshTokenEnvVar: 'HEY_JARVIS_MICROSOFT_REFRESH_TOKEN',
  scopes: [
    'https://graph.microsoft.com/Mail.ReadWrite',
    'https://graph.microsoft.com/Mail.Send',
    'offline_access', // Required for refresh token
  ],
  setupInstructions: [
    'Go to Azure Portal → App Registrations (https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps)',
    'Create a new app registration',
    'IMPORTANT: Under "Supported account types", select "Personal Microsoft accounts only" or "Accounts in any organizational directory and personal Microsoft accounts"',
    `Add ${REDIRECT_URI} to Redirect URIs under Authentication → Web`,
    'Create a client secret in Certificates & secrets',
  ],
  storageInstructions: [
    '1Password (Recommended):',
    '  - Store in "Microsoft OAuth" item in "Personal" vault',
    '  - Fields: client id, client secret, refresh token',
    '',
    'Home Assistant Addon:',
    '  - Go to Supervisor → Hey Jarvis MCP Server → Configuration',
    '  - Fields: microsoft_client_id, microsoft_client_secret, microsoft_refresh_token',
  ],
  createClient: (clientId: string, clientSecret: string) => {
    return new ConfidentialClientApplication({
      auth: {
        clientId,
        clientSecret,
        // Use /consumers/ endpoint for personal Microsoft accounts
        // Use /common/ only if app is configured with "All" user audience in Azure
        authority: 'https://login.microsoftonline.com/consumers',
      },
    });
  },
  getAuthUrl: async (client: ConfidentialClientApplication): Promise<string> => {
    const authCodeUrlParameters = {
      scopes: microsoftProvider.scopes,
      redirectUri: REDIRECT_URI,
      // Explicitly request authorization code flow
      responseMode: 'query' as const,
      // Add prompt to ensure fresh consent (helps with debugging)
      prompt: 'select_account' as const,
    };
    return await client.getAuthCodeUrl(authCodeUrlParameters);
  },
  exchangeCode: async (client: ConfidentialClientApplication, code: string): Promise<TokenResponse> => {
    const tokenRequest: AuthorizationCodeRequest = {
      code,
      scopes: microsoftProvider.scopes,
      redirectUri: REDIRECT_URI,
    };
    const response = await client.acquireTokenByCode(tokenRequest);

    // MSAL v3+ stores refresh tokens in an internal cache
    // We need to serialize the cache to extract the refresh token
    const account = response.account;
    if (!account) {
      throw new Error('No account found in token response');
    }

    // Get the token cache and serialize it
    const tokenCache = client.getTokenCache();
    const cacheState = await tokenCache.serialize();

    // Parse the serialized cache to extract refresh token
    let refreshToken: string | undefined;
    if (cacheState) {
      try {
        const cache = JSON.parse(cacheState);
        // Refresh tokens are stored in the RefreshToken section
        const refreshTokens = cache.RefreshToken || {};

        // Find the refresh token for this account
        // Key format: "<homeAccountId>-<environment>-refreshtoken-<clientId>--"
        const refreshTokenKey = Object.keys(refreshTokens).find((key) => key.includes(account.homeAccountId));

        if (refreshTokenKey) {
          refreshToken = refreshTokens[refreshTokenKey].secret;
        }
      } catch (err) {
        console.error('Failed to parse MSAL token cache:', err);
      }
    }

    if (!refreshToken) {
      throw new Error(
        'Failed to extract refresh token from MSAL cache. The token may not have been stored with offline_access scope.',
      );
    }

    return {
      access_token: response.accessToken,
      refresh_token: refreshToken,
      scope: response.scopes?.join(' ') || '',
      token_type: response.tokenType || 'Bearer',
      expiry_date: response.expiresOn?.getTime() || 0,
    };
  },
};
