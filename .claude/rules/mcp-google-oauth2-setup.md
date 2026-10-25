---
paths:
  - "mcp/**"
---

# Google OAuth2 Setup

> Part of [Jarvis Mastra AI Agents → Development](mcp-development.md). Paths in it are relative to `mcp/` unless they say otherwise.

The Calendar, Todo-List and Phone verticals use Google's official `googleapis` NPM package for accessing the Google Calendar, Google Tasks and Google People APIs. These APIs require OAuth2 authentication as they access private user data.

## Token Generation Behavior

The token generation script **automatically skips providers** that already have refresh tokens stored in Mastra storage. This means:

- ✅ **First run**: Generates tokens for all providers (opens browser for each)
- ✅ **Subsequent runs**: Only generates tokens for providers without stored tokens
- ✅ **Selective refresh**: Delete a specific provider's token from storage to regenerate only that one

To regenerate a token for a specific provider, delete it from storage first:
```bash
# Remove Google token to force regeneration
sqlite3 mcp/mastra.sql.db "DELETE FROM oauth_credentials WHERE provider='google';"

# Then run the generator - will only regenerate Google token
bun run --cwd mcp generate-tokens
```

## Why OAuth2?
- **Private Data Access**: Google Calendar, Tasks and Contacts contain personal information that requires user consent
- **API Key Limitation**: API keys only work for public data, not private calendars or task lists
- **Automatic Token Refresh**: The `googleapis` library handles access token refresh automatically
- **Long-Lived Tokens**: Refresh tokens remain valid for 6+ months with regular use

## Initial Setup (One-Time)

**Step 1: Create Google Cloud Project**
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select an existing one
3. Enable the following APIs:
   - Google Calendar API
   - Google Tasks API
   - Google People API

**Step 2: Configure OAuth2 Credentials**
1. Navigate to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth 2.0 Client ID**
3. Configure the OAuth consent screen (if prompted):
   - Choose "Internal" for personal use or "External" for broader access
   - Fill in application name and developer contact
4. Select **Web application** as the application type
5. Add authorized redirect URI: `http://localhost:3000/oauth2callback`
6. Save the **Client ID** and **Client Secret**

**Step 3: Generate Refresh Token**

Run the token generation script to obtain your refresh token:

```bash
# Run the interactive token generator
bun run --cwd mcp generate-tokens

# This will:
# 1. Open your browser for Google authorization
# 2. Request access to Calendar, Tasks and Contacts
# 3. Generate and store your refresh token
```

The script will guide you through:
- Opening the Google authorization page
- Granting access to your Calendar, Tasks and Contacts
- Receiving your long-lived refresh token

The token is written straight to Mastra storage and only summarised on screen (length + last three
characters), so a durable credential does not linger in terminal scrollback. When you need the full
value — to copy it into 1Password, for example — delete the stored copy and re-run with
`--reveal-token` (or `HEY_JARVIS_REVEAL_REFRESH_TOKEN=1`). Revealing is refused when a CI
environment is detected, because build logs outlive the job.

**Step 4: Store Credentials Securely**

You have four options for storing your OAuth2 credentials:

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

## 1Password Items

`mcp/op.env` maps each environment variable to an `op://` reference, resolved at process start by
`run-with-env.sh` — through the 1Password CLI locally, and through `OP_SERVICE_ACCOUNT_TOKEN` in the
release workflow and deployment. Everything lives in the **Jarvis** vault:

| Environment variable | 1Password reference |
| --- | --- |
| `HEY_JARVIS_GOOGLE_CLIENT_ID` | `op://Jarvis/Google/Hey Jarvis client ID` |
| `HEY_JARVIS_GOOGLE_CLIENT_SECRET` | `op://Jarvis/Google/Hey Jarvis client secret` |
| `HEY_JARVIS_GOOGLE_REFRESH_TOKEN` | `op://Jarvis/Google/Hey Jarvis refresh token` |

Adopting another Google API in a vertical needs no new item or field — Calendar, Tasks and Contacts
all authenticate with this one credential. What it does need is a **new refresh token value**,
because the scopes a token carries are fixed when it is minted:

```bash
# generate-tokens skips a provider that already has a stored token, so clear it first
sqlite3 mcp/mastra.sql.db "DELETE FROM oauth_credentials WHERE provider='google';"

# --reveal-token prints the full value to paste into 1Password; without it only a
# fingerprint is shown, and revealing is refused when CI is detected
bun run --cwd mcp generate-tokens --reveal-token
```

Then update the `Hey Jarvis refresh token` field on the **Google** item. Updating 1Password is the
step that matters beyond your own machine: the Mastra copy is local, so CI and the deployed
assistant keep using the vault's token until it is replaced.

## Token Lifecycle

**Access Tokens**:
- Short-lived (~1 hour)
- Automatically refreshed by the `googleapis` library
- No manual intervention needed

**Refresh Tokens**:
- Long-lived (6+ months with regular use)
- Used to obtain new access tokens
- Automatically renewed and stored when OAuth provider rotates them
- Will not expire as long as:
  - Used at least once every 6 months
  - Not revoked at [Google Account Permissions](https://myaccount.google.com/permissions)
  - Google Cloud Project credentials remain valid

**Automatic Token Renewal**:
Both Calendar and Todo-List verticals automatically update the stored refresh token when renewed:
```typescript
oauth2Client.on('tokens', async (tokens) => {
  if (tokens.refresh_token) {
    const credentialsStorage = await getCredentialsStorage();
    await credentialsStorage.renewRefreshToken('google', tokens.refresh_token);
    console.log('✅ Refresh token updated in storage');
  }
});
```

## Credential Management with Mastra Storage

When using `--store-in-mastra`, credentials are persisted in the LibSQL database and tools automatically fall back to stored credentials when environment variables are not set.

**Credential Lookup Order**:
1. Environment variables (`HEY_JARVIS_GOOGLE_CLIENT_ID`, `HEY_JARVIS_GOOGLE_CLIENT_SECRET`, `HEY_JARVIS_GOOGLE_REFRESH_TOKEN`)
2. Mastra storage (`oauth_credentials` table) - **refresh token only**

**Note**: Client ID and secret are ALWAYS read from environment variables. Only the refresh token can be stored in Mastra.

**Storage Schema**:
```sql
CREATE TABLE IF NOT EXISTS oauth_credentials (
  provider TEXT PRIMARY KEY,
  refresh_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

**Security Note**: Client IDs and secrets are intentionally NOT stored in the database. They must be provided via environment variables (`HEY_JARVIS_GOOGLE_CLIENT_ID` and `HEY_JARVIS_GOOGLE_CLIENT_SECRET`).

**Programmatic Access**:
```typescript
import { getCredentialsStorage } from './mastra/storage';

// Get stored refresh token
const credentialsStorage = await getCredentialsStorage();
const refreshToken = await credentialsStorage.getRefreshToken('google');

// Store/update refresh token manually
await credentialsStorage.setRefreshToken('google', newRefreshToken);

// Renew refresh token (called automatically by OAuth handlers)
await credentialsStorage.renewRefreshToken('google', renewedToken);

// List all stored providers
const providers = await credentialsStorage.listProviders();

// Delete refresh token
await credentialsStorage.deleteRefreshToken('google');
```

**Benefits**:
- **Persistent**: Refresh tokens survive container restarts
- **Automatic Fallback**: Tools check storage if refresh token env var is missing
- **Secure**: Client ID/secret never stored in database
- **Multi-Tenant**: Support multiple OAuth providers
- **Programmatic**: Easy token rotation

## Troubleshooting

**"No refresh token received" Error**:
- This happens if you previously authorized the application
- Solution:
  1. Go to [Google Account Permissions](https://myaccount.google.com/permissions)
  2. Remove this application
  3. Run `bun run --cwd mcp generate-tokens` again

**"Missing required Google OAuth2 credentials" Error**:
- Verify all three environment variables are set:
  - `HEY_JARVIS_GOOGLE_CLIENT_ID`
  - `HEY_JARVIS_GOOGLE_CLIENT_SECRET`
  - `HEY_JARVIS_GOOGLE_REFRESH_TOKEN`
- If using 1Password: Run `eval $(op signin)` to authenticate

**"Invalid grant" Error**:
- Refresh token has been revoked or expired
- Solution: Run `bun run --cwd mcp generate-tokens` to get a new token

**Authorization Timeout**:
- The token generator times out after 5 minutes
- Solution: Run the script again and complete authorization promptly

## Security Best Practices

- **Never commit credentials**: Always use 1Password or environment variables
- **Rotate tokens periodically**: Generate new tokens if you suspect compromise
- **Use internal consent screen**: For personal projects, use "Internal" OAuth consent screen
- **Monitor token usage**: Check [Google Account Activity](https://myaccount.google.com/security) regularly
- **Revoke old tokens**: Remove old application access from Google Account Permissions
