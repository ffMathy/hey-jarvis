---
paths:
  - "mcp/**"
---

# Adding New OAuth Providers

> Part of [Jarvis Mastra AI Agents → Development](mcp-development.md). Paths in it are relative to `mcp/` unless they say otherwise.

The token generation script (`mcp/generate-refresh-tokens.ts`) is designed to support multiple OAuth providers through a common interface. All configured providers will be processed automatically when the script runs.

OAuth provider configurations are defined in separate files under `mcp/mastra/credentials/`:
- `mcp/mastra/credentials/google.ts` - Google Calendar, Tasks and Contacts provider
- `mcp/mastra/credentials/microsoft.ts` - Microsoft Outlook/Email provider
- `mcp/mastra/credentials/types.ts` - Shared TypeScript interfaces
- `mcp/mastra/credentials/index.ts` - Module exports

## Provider Interface

Each OAuth provider must implement the `OAuthProvider` interface:

```typescript
interface OAuthProvider {
  name: string;                    // Display name (e.g., "Google", "Microsoft")
  clientIdEnvVar: string;          // Environment variable for client ID
  clientSecretEnvVar: string;      // Environment variable for client secret
  refreshTokenEnvVar: string;      // Environment variable for refresh token
  scopes: string[];                // OAuth scopes to request
  setupInstructions: string[];     // Steps for initial provider setup
  storageInstructions: string[];   // Instructions for storing credentials
  createClient: (clientId: string, clientSecret: string) => any;
  getAuthUrl: (client: any) => string;
  exchangeCode: (client: any, code: string) => Promise<TokenResponse>;
}
```

## Example: Adding Microsoft OAuth

```typescript
import { ConfidentialClientApplication } from '@azure/msal-node';

const microsoftProvider: OAuthProvider = {
  name: 'Microsoft',
  clientIdEnvVar: 'HEY_JARVIS_MICROSOFT_CLIENT_ID',
  clientSecretEnvVar: 'HEY_JARVIS_MICROSOFT_CLIENT_SECRET',
  refreshTokenEnvVar: 'HEY_JARVIS_MICROSOFT_REFRESH_TOKEN',
  scopes: [
    'https://graph.microsoft.com/Calendars.ReadWrite',
    'https://graph.microsoft.com/Tasks.ReadWrite',
    'offline_access', // Required for refresh token
  ],
  setupInstructions: [
    'Go to Azure Portal > App Registrations',
    'Create a new app registration',
    'Add http://localhost:3000/oauth2callback to redirect URIs',
    'Create a client secret in Certificates & secrets',
  ],
  storageInstructions: [
    '1Password:',
    '  - Store in "Microsoft OAuth" item',
    '  - Fields: client id, client secret, refresh token',
  ],
  createClient: (clientId: string, clientSecret: string) => {
    return new ConfidentialClientApplication({
      auth: {
        clientId,
        clientSecret,
        authority: 'https://login.microsoftonline.com/common',
      },
    });
  },
  getAuthUrl: (client) => {
    return client.getAuthCodeUrl({
      scopes: microsoftProvider.scopes,
      redirectUri: REDIRECT_URI,
    });
  },
  exchangeCode: async (client, code: string) => {
    const result = await client.acquireTokenByCode({
      code,
      scopes: microsoftProvider.scopes,
      redirectUri: REDIRECT_URI,
    });
    return {
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      scope: result.scopes.join(' '),
      token_type: result.tokenType,
      expiry_date: result.expiresOn?.getTime() || 0,
    };
  },
};

// Add to PROVIDERS array
const PROVIDERS: OAuthProvider[] = [
  googleProvider,
  microsoftProvider, // New provider
];
```

## Steps to Add a New Provider

1. **Install Provider SDK**: Add the OAuth library to package.json
   ```bash
   bun add @provider/oauth-library
   ```

2. **Create Provider Configuration**: Create a new provider file in `mcp/mastra/credentials/`
   - Set appropriate environment variable names
   - Configure OAuth scopes for required APIs
   - Implement client creation, auth URL generation, and token exchange
   ```typescript
   // mcp/mastra/credentials/your-provider.ts
   import type { OAuthProvider, TokenResponse } from './types.js';
   
   export const yourProvider: OAuthProvider = {
     name: 'YourProvider',
     // ... provider configuration
   };
   ```

3. **Export Provider**: Add your provider to `mcp/mastra/credentials/index.ts`
   ```typescript
   export * from './types.js';
   export { googleProvider } from './google.js';
   export { microsoftProvider } from './microsoft.js';
   export { yourProvider } from './your-provider.js'; // Add here
   ```

4. **Register Provider**: Import and add to PROVIDERS array in `mcp/mastra/generate-refresh-tokens.ts`
   ```typescript
   import { googleProvider, microsoftProvider, yourProvider } from './credentials/index.js';
   
   const PROVIDERS: OAuthProvider[] = [
     googleProvider,
     microsoftProvider,
     yourProvider, // Add here
   ];
   ```

5. **Update Environment Files**: Add new variables to `mcp/op.env` — or to `mcp/op.optional.env` if the server
   must keep running while the 1Password item does not exist yet (a missing `mcp/op.env` reference stops it)
   ```bash
   HEY_JARVIS_YOUR_PROVIDER_CLIENT_ID="op://Jarvis/Your Provider/Hey Jarvis client ID"
   HEY_JARVIS_YOUR_PROVIDER_CLIENT_SECRET="op://Jarvis/Your Provider/Hey Jarvis client secret"
   HEY_JARVIS_YOUR_PROVIDER_REFRESH_TOKEN="op://Jarvis/Your Provider/Hey Jarvis refresh token"
   ```

6. **Run Token Generation**: Execute `bun run --cwd mcp generate-tokens`
   - Script will process ALL providers automatically
   - Skip any provider with missing credentials
   - Each provider opens its own browser authorization flow

7. **Update Documentation**: Add provider-specific notes to this rule (`.claude/rules/mcp.md`)

## Multi-Provider Benefits

- **Automatic Processing**: All providers run sequentially without user intervention
- **Graceful Skipping**: Providers without credentials are skipped automatically
- **Consistent UX**: Same flow for all providers (open browser, authorize, receive token)
- **Easy Maintenance**: Add providers without modifying core script logic
- **Type Safety**: TypeScript ensures all providers implement the required interface
