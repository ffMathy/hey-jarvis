#!/usr/bin/env bun
/**
 * OAuth2 Refresh Token Generator
 * 
 * This script helps you obtain refresh tokens for multiple OAuth2 providers
 * by walking you through the authorization flow in your browser for each provider.
 * 
 * Supported Providers:
 * - Google (Calendar, Tasks APIs)
 * 
 * Usage:
 *   bunx nx generate-tokens mcp
 *   # OR directly:
 *   bun run mcp/scripts/generate-refresh-tokens.ts
 */

import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import * as http from 'http';
import { URL } from 'url';
import open from 'open';

const PORT = 3000;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  scope: string;
  token_type: string;
  expiry_date: number;
}

interface OAuthProvider {
  name: string;
  clientIdEnvVar: string;
  clientSecretEnvVar: string;
  refreshTokenEnvVar: string;
  scopes: string[];
  setupInstructions: string[];
  storageInstructions: string[];
  createClient: (clientId: string, clientSecret: string) => any;
  getAuthUrl: (client: any) => string;
  exchangeCode: (client: any, code: string) => Promise<TokenResponse>;
}

/**
 * Google OAuth2 Provider Configuration
 */
const googleProvider: OAuthProvider = {
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

/**
 * All configured OAuth providers
 * Add new providers to this array to support additional services
 */
const PROVIDERS: OAuthProvider[] = [
  googleProvider,
  // Add more providers here in the future
];

/**
 * Validates that required environment variables are set for a provider
 */
function validateProviderCredentials(provider: OAuthProvider): { clientId: string; clientSecret: string } {
  const clientId = process.env[provider.clientIdEnvVar];
  const clientSecret = process.env[provider.clientSecretEnvVar];

  if (!clientId || !clientSecret) {
    console.error(`❌ Missing required environment variables for ${provider.name}:`);
    console.error(`   - ${provider.clientIdEnvVar}`);
    console.error(`   - ${provider.clientSecretEnvVar}`);
    console.error('');
    console.error('Please set these in your environment or op.env file.');
    throw new Error(`Missing credentials for ${provider.name}`);
  }

  return { clientId, clientSecret };
}

/**
 * Starts a local HTTP server to receive the OAuth2 callback
 */
function startCallbackServer(provider: OAuthProvider, client: any): Promise<TokenResponse> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (!req.url) {
          return;
        }

        const url = new URL(req.url, `http://localhost:${PORT}`);
        
        if (url.pathname === '/oauth2callback') {
          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body>
                  <h1>❌ Authorization Failed</h1>
                  <p>Error: ${error}</p>
                  <p>You can close this window.</p>
                </body>
              </html>
            `);
            reject(new Error(`Authorization failed: ${error}`));
            server.close();
            return;
          }

          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body>
                  <h1>❌ Missing Authorization Code</h1>
                  <p>You can close this window.</p>
                </body>
              </html>
            `);
            reject(new Error('No authorization code received'));
            server.close();
            return;
          }

          // Exchange authorization code for tokens
          const tokens = await provider.exchangeCode(client, code);

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body>
                <h1>✅ Authorization Successful!</h1>
                <p>You can close this window and return to the terminal.</p>
              </body>
            </html>
          `);

          resolve(tokens as TokenResponse);
          server.close();
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body>
              <h1>❌ Server Error</h1>
              <p>An error occurred processing your request.</p>
              <p>You can close this window.</p>
            </body>
          </html>
        `);
        reject(err);
        server.close();
      }
    });

    server.listen(PORT, () => {
      console.log(`🌐 Callback server listening on http://localhost:${PORT}`);
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Authorization timeout - no response received after 5 minutes'));
    }, 5 * 60 * 1000);
  });
}

/**
 * Process a single OAuth provider
 */
async function processProvider(provider: OAuthProvider): Promise<void> {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`🔐 ${provider.name} OAuth2 Setup`);
  console.log('='.repeat(70));
  console.log('');
  console.log('📋 Prerequisites:');
  provider.setupInstructions.forEach((instruction, i) => {
    console.log(`   ${i + 1}. ${instruction}`);
  });
  console.log('');

  // Validate credentials
  let credentials: { clientId: string; clientSecret: string };
  try {
    credentials = validateProviderCredentials(provider);
  } catch (error) {
    console.error(`⏭️  Skipping ${provider.name} - credentials not configured\n`);
    return;
  }

  // Create OAuth client
  const client = provider.createClient(credentials.clientId, credentials.clientSecret);
  const authUrl = provider.getAuthUrl(client);

  console.log('🌐 Opening authorization page in your browser...');
  console.log(`   If it doesn't open automatically, visit: ${authUrl}\n`);

  // Open the browser for authorization
  await open(authUrl);

  console.log('⏳ Waiting for authorization...\n');

  try {
    const tokens = await startCallbackServer(provider, client);

    if (!tokens.refresh_token) {
      console.error(`❌ No refresh token received for ${provider.name}!`);
      console.error('   This can happen if you previously authorized this application.');
      console.error('   To fix this:');
      console.error('   1. Revoke access in your account settings');
      console.error('   2. Run this script again');
      return;
    }

    console.log('✅ Authorization successful!\n');
    console.log('📝 Your refresh token:');
    console.log('─'.repeat(70));
    console.log(tokens.refresh_token);
    console.log('─'.repeat(70));
    console.log('');

    console.log('💾 Store this token securely:\n');
    provider.storageInstructions.forEach((instruction) => {
      console.log(`   ${instruction}`);
    });
    console.log('');
    console.log(`   Environment variable: ${provider.refreshTokenEnvVar}="${tokens.refresh_token}"\n`);

  } catch (error) {
    console.error(`❌ Error during ${provider.name} authorization:`);
    console.error(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Main execution flow
 */
async function main() {
  console.log('🔐 OAuth2 Refresh Token Generator');
  console.log('   Generate refresh tokens for all configured OAuth providers\n');
  console.log(`📋 Configured providers: ${PROVIDERS.map(p => p.name).join(', ')}\n`);
  console.log('💡 Note: Refresh tokens remain valid for 6+ months with regular use\n');

  for (const provider of PROVIDERS) {
    await processProvider(provider);
  }

  console.log('\n' + '='.repeat(70));
  console.log('🎉 Token generation complete!');
  console.log('='.repeat(70));
  console.log('\n📌 Remember to:');
  console.log('   - Store all tokens securely (1Password recommended)');
  console.log('   - Update your environment configuration (mcp/op.env)');
  console.log('   - Restart the MCP server to use the new tokens\n');
}

main().catch((error) => {
  console.error('❌ Unexpected error:');
  console.error(error);
  process.exit(1);
});
