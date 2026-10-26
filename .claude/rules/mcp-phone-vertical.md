---
paths:
  - "mcp/**"
---

# Phone Vertical

> Part of [Jarvis Mastra AI Agents → Current Agents](mcp-current-agents.md). Paths in it are relative to `mcp/` unless they say otherwise.

Provides outbound calling, texting and contact lookup, and feeds the phone's notifications to Synapse:
- **4 phone tools**: Place calls, send texts, and read the user's Google address book
- **No agents**: The tools are for use by other agents
- **Notifications**: Maps the Android notifications the Home Assistant event monitor sees into Synapse state changes (see [Phone Notifications Into Synapse](mcp-phone-notifications-into-synapse.md#phone-notifications-into-synapse))
- **Twilio integration**: Uses ElevenLabs Conversational AI platform with Twilio for phone calls
- **Custom first message**: Each call can specify a custom greeting message for the recipient
- **Conversation support**: After the initial message, the agent can engage in conversation with the recipient
- **Contact resolution**: Turns a spoken name ("mom", "Sarah") into the E.164 number the calling and texting tools require

**Available Tools:**
- **`initiatePhoneCall`**: Initiates an outbound phone call to a specified phone number
  - Requires phone number in E.164 format (e.g., "+1234567890")
  - Accepts a custom first message for the agent to speak
  - Returns conversation ID and call SID on success
  - Uses ElevenLabs conversational agent for the phone interaction
- **`sendTextMessage`**: Sends an SMS via Twilio to a phone number in E.164 format
- **`lookupContact`**: Resolves a name or nickname to matching contacts and their phone numbers
  - Matching ignores case, accents and punctuation, so voice transcripts match stored spellings
  - Returns several matches with `isAmbiguous` set, rather than guessing between two people of the same name
  - Filters to contacts that have a phone number by default (`requirePhoneNumber`)
- **`getContacts`**: Lists the whole address book, with `maxResults` and `forceRefresh`
  - Reads Google Contacts, which is what syncs to the user's phone — nothing runs on the phone itself
  - Numbers are normalized to E.164 via `libphonenumber-js`; one that cannot be placed is returned as stored with `isE164: false`
  - Results are cached for 5 minutes, since a lookup ranks the entire address book locally

**Required Environment Variables:**
- `HEY_JARVIS_ELEVENLABS_API_KEY`: ElevenLabs API key for authentication
- `HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID` or `HEY_JARVIS_ELEVENLABS_AGENT_ID`: ID of the ElevenLabs conversational agent to use (test agent ID takes precedence if set)
- `HEY_JARVIS_TWILIO_ACCOUNT_SID`, `HEY_JARVIS_TWILIO_AUTH_TOKEN`, `HEY_JARVIS_TWILIO_PHONE_NUMBER`: Twilio credentials for `sendTextMessage`
- `HEY_JARVIS_GOOGLE_CLIENT_ID`, `HEY_JARVIS_GOOGLE_CLIENT_SECRET`, `HEY_JARVIS_GOOGLE_REFRESH_TOKEN`: Google OAuth2 credentials for the contact tools

**Example Usage:**
```typescript
// Initiate a phone call with custom greeting
await phoneTools.initiatePhoneCall.execute({
  phoneNumber: '+1234567890',
  firstMessage: 'Hello, this is Jarvis calling to remind you about your upcoming appointment.',
});

// Resolve a spoken name, then text whoever it turned out to be
const { matches } = await executeTool(lookupContact, { name: 'mom' });
const [contact] = matches;
const number = contact?.phoneNumbers.find((phoneNumber) => phoneNumber.isE164);

if (number) {
  await executeTool(sendTextMessage, { phoneNumber: number.value, message: 'Running 10 minutes late' });
}
```

**Setup Requirements:**
1. Create an ElevenLabs account and obtain an API key
2. Create a conversational agent in ElevenLabs
3. Configure a Twilio phone number in ElevenLabs for outbound calls
4. Store the credentials in 1Password:
   - `op://Jarvis/ElevenLabs/API key`
   - `op://Jarvis/ElevenLabs/Jarvis agent ID`
   - `op://Jarvis/Twilio/Account SID`, `op://Jarvis/Twilio/Auth token`, `op://Jarvis/Twilio/Phone number` for `sendTextMessage`
5. The contact tools reuse the **existing** Google OAuth credentials — no new 1Password item or field:
   - `op://Jarvis/Google/Hey Jarvis client ID` → `HEY_JARVIS_GOOGLE_CLIENT_ID` (unchanged)
   - `op://Jarvis/Google/Hey Jarvis client secret` → `HEY_JARVIS_GOOGLE_CLIENT_SECRET` (unchanged)
   - `op://Jarvis/Google/Hey Jarvis refresh token` → `HEY_JARVIS_GOOGLE_REFRESH_TOKEN` (**value must be replaced**)
6. Enable the **Google People API** in the Google Cloud project, then mint a refresh token carrying the contacts scope:
   ```bash
   # generate-tokens skips a provider that already has a stored token, so clear it first
   sqlite3 mcp/mastra.sql.db "DELETE FROM oauth_credentials WHERE provider='google';"

   # --reveal-token prints the full value so it can be pasted into 1Password;
   # without it only a fingerprint is shown, and revealing is refused on CI
   bun run --cwd mcp generate-tokens --reveal-token
   ```
   - Paste the new value into the `refresh token` field of the **Google OAuth** item in the **Personal** vault
   - Updating 1Password is what matters for deployment and for the integration tests: both resolve `mcp/op.env` from the vault, so a stale vault copy leaves them on a token without the contacts scope
   - Client ID and secret are always read from environment variables; only the refresh token can also live in Mastra storage
   - See [Google OAuth2 Setup](mcp-google-oauth2-setup.md#google-oauth2-setup) for the full flow
