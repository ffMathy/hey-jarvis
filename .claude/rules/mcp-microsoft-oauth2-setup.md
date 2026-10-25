---
paths:
  - "mcp/**"
---

# Microsoft OAuth2 Setup

> Part of [Jarvis Mastra AI Agents → Development](mcp-development.md). Paths in it are relative to `mcp/` unless they say otherwise.

The Email vertical uses Microsoft OAuth2 for accessing Outlook/Microsoft 365 email through the Microsoft Graph API.

## Why OAuth2?
- **Private Data Access**: Email contains personal information that requires user consent
- **API Key Limitation**: Microsoft Graph doesn't support API keys for email access
- **Automatic Token Refresh**: The `@azure/msal-node` library handles access token refresh automatically
- **Long-Lived Tokens**: Refresh tokens remain valid for 90+ days with regular use

## Initial Setup (One-Time)

**Step 1: Create Azure App Registration**
1. Go to [Azure Portal → App Registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps)
2. Create a new app registration
3. **IMPORTANT**: Under "Supported account types", select:
   - "Accounts in any organizational directory and personal Microsoft accounts" (for `/consumers/` endpoint)
   - OR "Personal Microsoft accounts only" (also uses `/consumers/` endpoint)
4. Select **Web** as the platform type
5. Add redirect URI: `http://localhost:3000/oauth2callback`

**Step 2: Configure API Permissions**
1. Navigate to **API permissions**
2. Click **Add a permission** → **Microsoft Graph**
3. Select **Delegated permissions**
4. Add the following permissions:
   - `Mail.ReadWrite` - Read and write mail
   - `Mail.Send` - Send mail
   - `offline_access` - Required for refresh token
5. Grant admin consent (if required by your organization)

**Step 3: Create Client Secret**
1. Navigate to **Certificates & secrets**
2. Click **New client secret**
3. Add a description and set expiration (recommended: 24 months)
4. Save the **Client Secret Value** immediately (it won't be shown again)
5. Note the **Application (client) ID** from the Overview page

**Step 4: Generate Refresh Token**

Run the token generation script:

```bash
# Run the interactive token generator
bun run --cwd mcp generate-tokens

# This will:
# 1. Open your browser for Microsoft authorization
# 2. Request access to your Email
# 3. Generate and store your refresh token automatically
```

The script will guide you through:
- Opening the Microsoft authorization page
- Granting access to your Email
- Receiving your long-lived refresh token

**Step 5: Store Credentials Securely**

Credentials are automatically stored in Mastra storage:

**Mastra Storage (Default)**
```bash
# Generate tokens and store refresh token in Mastra's LibSQL database
bun run --cwd mcp generate-tokens

# This will:
# 1. Guide you through the OAuth flow
# 2. Store ONLY the refresh token in oauth_credentials table
# 3. Client ID and secret must still be set in environment variables
```

**Benefits**:
- Persistent refresh token across container restarts
- Automatic token renewal when OAuth provider rotates tokens
- Client ID/secret in env vars (more secure)
- Single source for refresh tokens across deployments

**Note**: Client ID and secret must always be provided via environment variables for security.

## Token Lifecycle

**Access Tokens**:
- Short-lived (~1 hour)
- Automatically refreshed by the `@azure/msal-node` library
- No manual intervention needed

**Refresh Tokens**:
- Long-lived (90+ days with regular use, up to 6 months with continuous use)
- Used to obtain new access tokens
- Automatically renewed and stored when OAuth provider rotates them
- Will not expire as long as:
  - Used at least once every 90 days
  - Not revoked at [Microsoft Account Permissions](https://account.microsoft.com/privacy/ad-settings)
  - Azure App Registration remains active

**Automatic Token Renewal**:
The Email vertical automatically updates the stored refresh token when renewed:
```typescript
const response = await msalClient.acquireTokenByRefreshToken(tokenRequest);

if (response.refreshToken && response.refreshToken !== refreshToken) {
  const credentialsStorage = await getCredentialsStorage();
  await credentialsStorage.renewRefreshToken('microsoft', response.refreshToken);
  console.log('✅ Refresh token updated in storage');
}
```

## Troubleshooting

**"No refresh token received" Error**:
- Make sure you included `offline_access` scope in the app registration
- Solution:
  1. Go to Azure Portal → App Registrations → Your App → API permissions
  2. Ensure `offline_access` is listed
  3. Run `bun run --cwd mcp generate-tokens` again

**"Missing required Microsoft OAuth2 credentials" Error**:
- Verify all three environment variables are set:
  - `HEY_JARVIS_MICROSOFT_CLIENT_ID`
  - `HEY_JARVIS_MICROSOFT_CLIENT_SECRET`
  - `HEY_JARVIS_MICROSOFT_REFRESH_TOKEN`
- If using 1Password: Run `eval $(op signin)` to authenticate

**"Invalid grant" Error**:
- Refresh token has been revoked or expired
- Solution: Run `bun run --cwd mcp generate-tokens` to get a new token

**"AADSTS65001: User consent required" Error**:
- Admin consent is required for your organization
- Solution: Contact your IT administrator to grant consent for the app

**Authorization Timeout**:
- The token generator times out after 5 minutes
- Solution: Run the script again and complete authorization promptly

## Security Best Practices

- **Never commit credentials**: Always use 1Password or environment variables
- **Rotate tokens periodically**: Generate new tokens if you suspect compromise
- **Use appropriate scopes**: Only request the minimum permissions needed
- **Monitor token usage**: Check [Microsoft Account Activity](https://account.microsoft.com/account) regularly
- **Revoke old tokens**: Remove old application access from Microsoft Account Permissions
- **Set client secret expiration**: Use shorter expiration periods (6-12 months) for better security
