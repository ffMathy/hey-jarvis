import { type Auth, google } from 'googleapis';

type OAuth2Client = Auth.OAuth2Client;

import type { OAuthProvider, TokenResponse } from './types.js';

const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

export const googleProvider: OAuthProvider = {
  name: 'Google',
  clientIdEnvVar: 'HEY_JARVIS_GOOGLE_CLIENT_ID',
  clientSecretEnvVar: 'HEY_JARVIS_GOOGLE_CLIENT_SECRET',
  refreshTokenEnvVar: 'HEY_JARVIS_GOOGLE_REFRESH_TOKEN',
  scopes: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/tasks'],
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
  getAuthUrl: (client: unknown): string => {
    const oauth2Client = client as OAuth2Client;
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: googleProvider.scopes,
    });
  },
  exchangeCode: async (client: unknown, code: string): Promise<TokenResponse> => {
    const oauth2Client = client as OAuth2Client;
    const { tokens } = await oauth2Client.getToken(code);
    return tokens as TokenResponse;
  },
};
