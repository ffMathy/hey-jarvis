import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import type { OAuthProvider, TokenResponse } from './types.js';

const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

export const googleProvider: OAuthProvider = {
  name: 'Google',
  clientIdEnvVar: 'HEY_JARVIS_GOOGLE_CLIENT_ID',
  clientSecretEnvVar: 'HEY_JARVIS_GOOGLE_CLIENT_SECRET',
  refreshTokenEnvVar: 'HEY_JARVIS_GOOGLE_REFRESH_TOKEN',
  scopes: [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/tasks',
  ],
  setupInstructions: [
    'Create a Google Cloud Project at https://console.cloud.google.com',
    'Enable Google Calendar API and Google Tasks API',
    'Create OAuth 2.0 credentials (Web application type)',
    `Add ${REDIRECT_URI} to authorized redirect URIs`,
  ],
  storageInstructions: [
    '1Password (Recommended):',
    '  - Store in "Google OAuth" item in "Personal" vault',
    '  - Fields: client id, client secret, refresh token',
    '',
    'Home Assistant Addon:',
    '  - Go to Supervisor → Hey Jarvis MCP Server → Configuration',
    '  - Fields: google_client_id, google_client_secret, google_refresh_token',
  ],
  createClient: (clientId: string, clientSecret: string): OAuth2Client => {
    return new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  },
  getAuthUrl: (client: OAuth2Client): string => {
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: googleProvider.scopes,
    });
  },
  exchangeCode: async (client: OAuth2Client, code: string): Promise<TokenResponse> => {
    const { tokens } = await client.getToken(code);
    return tokens as TokenResponse;
  },
};
