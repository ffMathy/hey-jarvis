#!/usr/bin/env bun
/**
 * OAuth2 Refresh Token Generator
 *
 * This script helps you obtain refresh tokens for multiple OAuth2 providers
 * by walking you through the authorization flow in your browser for each provider.
 *
 * Tokens are automatically stored in Mastra storage (LibSQL database).
 * Client ID and secret must be set in environment variables.
 *
 * Supported Providers:
 * - Google (Calendar, Tasks APIs)
 * - Microsoft (Outlook/Email via Graph API)
 *
 * Usage:
 *   bun run --cwd mcp generate-tokens
 *   # OR directly:
 *   bun run mcp/mastra/generate-refresh-tokens.ts
 */

import * as http from 'http';
import open from 'open';
import { URL } from 'url';
import { googleProvider, microsoftProvider, type OAuthProvider, type TokenResponse } from './credentials/index.js';
import { getCredentialsStorage } from './storage/index.js';

const PORT = 3000;

const PROVIDERS: OAuthProvider[] = [googleProvider, microsoftProvider];

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
 * Sends an HTML error response
 */
function sendErrorResponse(
  res: http.ServerResponse,
  statusCode: number,
  title: string,
  message: string,
  details?: string,
): void {
  res.writeHead(statusCode, { 'Content-Type': 'text/html' });
  res.end(`
    <html>
      <body>
        <h1>${title}</h1>
        <p>${message}</p>
        ${details ? `<p>${details}</p>` : ''}
        <p>You can close this window.</p>
      </body>
    </html>
  `);
}

/**
 * Sends an HTML success response
 */
function sendSuccessResponse(res: http.ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`
    <html>
      <body>
        <h1>Authorization Successful!</h1>
        <p>You can close this window and return to the terminal.</p>
      </body>
    </html>
  `);
}

/**
 * Handles the OAuth callback request
 */
async function handleOAuthCallback(
  url: URL,
  res: http.ServerResponse,
  provider: OAuthProvider,
  client: unknown,
  server: http.Server,
  resolve: (value: TokenResponse) => void,
  reject: (reason: Error) => void,
): Promise<void> {
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  if (error) {
    const errorMsg = errorDescription ? `${error}: ${errorDescription}` : error;
    sendErrorResponse(res, 400, 'Authorization Failed', `Error: ${error}`, errorDescription ?? undefined);
    reject(new Error(`Authorization failed: ${errorMsg}`));
    server.close();
    return;
  }

  if (!code) {
    sendErrorResponse(res, 400, 'Missing Authorization Code', 'No authorization code received');
    reject(new Error('No authorization code received'));
    server.close();
    return;
  }

  // Exchange authorization code for tokens
  const tokens = await provider.exchangeCode(client, code);
  sendSuccessResponse(res);
  resolve(tokens as TokenResponse);
  server.close();
}

/**
 * Starts a local HTTP server to receive the OAuth2 callback
 */
function startCallbackServer(provider: OAuthProvider, client: unknown): Promise<TokenResponse> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url) {
        return;
      }

      const url = new URL(req.url, `http://localhost:${PORT}`);

      if (url.pathname === '/oauth2callback') {
        void (async () => {
          try {
            await handleOAuthCallback(url, res, provider, client, server, resolve, reject);
          } catch (err: unknown) {
            sendErrorResponse(res, 500, 'Server Error', 'An error occurred processing your request.');
            reject(err);
            server.close();
          }
        })();
      }
    });

    server.listen(PORT, () => {
      console.log(`🌐 Callback server listening on http://localhost:${PORT}`);
    });

    // Timeout after 5 minutes
    setTimeout(
      () => {
        server.close();
        reject(new Error('Authorization timeout - no response received after 5 minutes'));
      },
      5 * 60 * 1000,
    );
  });
}

/**
 * Process a single OAuth provider
 */
async function processProvider(
  provider: OAuthProvider,
): Promise<{ provider: string; credentials?: { clientId: string; clientSecret: string; refreshToken: string } }> {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`🔐 ${provider.name} OAuth2 Setup`);
  console.log('='.repeat(70));
  console.log('');

  // Check if token already exists in storage
  const credentialsStorage = await getCredentialsStorage();
  const existingToken = await credentialsStorage.getRefreshToken(provider.name.toLowerCase());
  if (existingToken) {
    console.log('✅ Refresh token already exists in Mastra storage');
    console.log('⏭️  Skipping token generation\n');
    return { provider: provider.name };
  }

  console.log('📋 Prerequisites:');
  provider.setupInstructions.forEach((instruction, i) => {
    console.log(`   ${i + 1}. ${instruction}`);
  });
  console.log('');

  // Validate credentials
  const credentials = validateProviderCredentials(provider);

  // Create OAuth client
  const client = provider.createClient(credentials.clientId, credentials.clientSecret);
  const authUrl = await provider.getAuthUrl(client);

  console.log('🌐 Opening authorization page in your browser...');
  console.log(`   If it doesn't open automatically, visit: ${authUrl}\n`);

  // Open the browser for authorization
  await open(authUrl);

  console.log('⏳ Waiting for authorization...\n');

  const tokens = await startCallbackServer(provider, client);

  if (!tokens.refresh_token) {
    console.error(`❌ No refresh token received for ${provider.name}!`);
    console.error('   This can happen if you previously authorized this application.');
    console.error('   To fix this:');
    console.error('   1. Revoke access in your account settings');
    console.error('   2. Run this script again');
    return { provider: provider.name };
  }

  console.log('✅ Authorization successful!\n');
  console.log('📝 Your refresh token:');
  console.log('─'.repeat(70));
  console.log(tokens.refresh_token);
  console.log('─'.repeat(70));
  console.log('');

  // Always store in Mastra storage
  const credStorage = await getCredentialsStorage();
  await credStorage.setRefreshToken(provider.name.toLowerCase(), tokens.refresh_token);
  console.log('✅ Stored refresh token in Mastra storage (mastra.sql.db)');
  console.log('⚠️  Note: Client ID and secret must still be set in environment variables\n');

  console.log('💾 Token storage information:\n');
  provider.storageInstructions.forEach((instruction) => {
    console.log(`   ${instruction}`);
  });
  console.log('');
  console.log(`   Environment variable: ${provider.refreshTokenEnvVar}="${tokens.refresh_token}"\n`);

  return {
    provider: provider.name,
    credentials: {
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      refreshToken: tokens.refresh_token,
    },
  };
}

/**
 * Main execution flow
 */
async function main() {
  console.log('🔐 OAuth2 Refresh Token Generator');
  console.log('   Generate refresh tokens for all configured OAuth providers\n');
  console.log(`📋 Configured providers: ${PROVIDERS.map((p) => p.name).join(', ')}\n`);
  console.log('💡 Note: Refresh tokens remain valid for 6+ months with regular use\n');
  console.log('💾 Tokens will be stored in Mastra storage (mastra.sql.db)\n');

  const results: Array<{ provider: string; success: boolean }> = [];

  for (const provider of PROVIDERS) {
    const result = await processProvider(provider);
    results.push({
      provider: result.provider,
      success: !!result.credentials,
    });
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log('🎉 Token generation complete!');
  console.log('='.repeat(70));

  // Summary
  console.log('\n📊 Summary:');
  results.forEach((result) => {
    const icon = result.success ? '✅' : '⏭️';
    const status = result.success ? 'Success' : 'Skipped';
    console.log(`   ${icon} ${result.provider}: ${status}`);
  });

  console.log('\n📌 Remember to:');
  console.log('   - Tokens are stored in Mastra storage (mastra.sql.db)');
  console.log('   - Set client ID and secret in environment variables');
  console.log('   - Restart the MCP server to use the new tokens\n');

  console.log('💡 Tip: Your calendar/todo-list tools will automatically use stored credentials');
  console.log('   if environment variables are not set.\n');
}

void (async () => {
  try {
    await main();
  } catch (error) {
    console.error('❌ Unexpected error:');
    console.error(error);
    process.exit(1);
  }
})();
