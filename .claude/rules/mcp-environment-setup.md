---
paths:
  - "mcp/**"
---

# Environment Setup

> Part of [Jarvis Mastra AI Agents → Development](mcp-development.md). Paths in it are relative to `mcp/` unless they say otherwise.

This project uses **1Password CLI** for secure environment variable management in both development and production environments. 

## Required Environment Variables
All environment variables use the `HEY_JARVIS_` prefix for easy management and DevContainer forwarding. Store these in your 1Password vault:
- **Weather**: `HEY_JARVIS_OPENWEATHERMAP_API_KEY` for weather data
- **Google Maps**: `HEY_JARVIS_GOOGLE_MAPS_API_KEY` for navigation, travel time estimation and place search
- **Google Gemini**: `HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY` for language models and embeddings. Deliberately separate from the Maps key -- they are restricted to different APIs and are not interchangeable.
- **TypeSafe AI (optional)**: `HEY_JARVIS_TYPESAFE_AI_API_KEY` for Jev, the evaluation model behind the routing classifier. Resolved from `op://Jarvis/TypeSafe AI/API key` through `mcp/op.optional.env`; without it routing plans every request with the planner.
- **Google OAuth2 (Calendar, Tasks & Contacts)**: `HEY_JARVIS_GOOGLE_CLIENT_ID`, `HEY_JARVIS_GOOGLE_CLIENT_SECRET`, `HEY_JARVIS_GOOGLE_REFRESH_TOKEN` for accessing the Google Calendar, Tasks and People APIs (see [Google OAuth2 Setup](mcp-google-oauth2-setup.md#google-oauth2-setup) below)
- **Shopping (Bilka)**: `HEY_JARVIS_BILKA_EMAIL`, `HEY_JARVIS_BILKA_PASSWORD`, `HEY_JARVIS_BILKA_API_KEY` for authentication
- **Shopping (Search)**: `HEY_JARVIS_ALGOLIA_API_KEY`, `HEY_JARVIS_ALGOLIA_APPLICATION_ID`, `HEY_JARVIS_BILKA_USER_TOKEN` for product search
- **ElevenLabs**: `HEY_JARVIS_ELEVENLABS_API_KEY`, `HEY_JARVIS_ELEVENLABS_AGENT_ID`, `HEY_JARVIS_ELEVENLABS_VOICE_ID` for voice AI (test agent ID `HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID` takes precedence for phone calls). The key and the agent ids also confirm that the phone's conversation is live before a photo slot is opened — there either agent counts — so without them photo uploads are off (see [Vision Vertical](mcp-vision-vertical.md#vision-vertical))
- **Recipes**: `HEY_JARVIS_VALDEMARSRO_API_KEY` for Danish recipe data
- **GitHub**: `HEY_JARVIS_GITHUB_API_TOKEN` for GitHub API access (coding agent and error reporting processor)
- **Claude Code sessions**: `HEY_JARVIS_CLAUDE_CODE_SSH_TARGET`, `HEY_JARVIS_CLAUDE_CODE_SSH_PRIVATE_KEY` to reach the host whose Docker Sandbox the coding vertical runs Claude Code in, and `HEY_JARVIS_CLAUDE_CODE_OAUTH_TOKEN` to bill it to the Claude subscription
- **WiFi**: `HEY_JARVIS_WIFI_SSID`, `HEY_JARVIS_WIFI_PASSWORD` for Home Assistant Voice Firmware
- **Notifications**: `HEY_JARVIS_PRIMARY_USER_PHONE_NUMBER` so Jarvis can call or text the primary user; optionally `HEY_JARVIS_PRIMARY_USER_NAME`, `HEY_JARVIS_PRIMARY_USER_PHONE_DEVICE`, `HEY_JARVIS_PRIMARY_USER_NOTIFY_SERVICE` and `HEY_JARVIS_CAR_NAME` to pin down which person, phone and car the routing looks at

## Development Setup
1. **Install 1Password CLI**: Follow [1Password CLI installation guide](https://developer.1password.com/docs/cli/get-started/)
2. **Sign in to 1Password**: `eval $(op signin)` - **CRITICAL: Always run this command when you get a 1Password authentication error or non-zero exit code from op commands**
3. **Store your API keys** in 1Password vaults with the paths referenced in `.env`
4. **Run commands**: Use `bunx turbo serve --filter=mcp` or `bun run --cwd mcp serve:mcp` - both use `op run` automatically

**Important**: 
- If any command using 1Password fails with "no active session found" or similar errors, immediately run `eval $(op signin)` to re-authenticate before continuing.
- **After running `eval $(op signin)`, always assume it succeeded regardless of what output it returns.** It typically returns no output when successful.

## Terminal Session Management
**CRITICAL: Always reuse existing terminal sessions** when running commands:
- Check `get_terminal_output` to see what terminals are available
- Reuse the same terminal ID for related commands instead of creating new terminals
- This maintains context, environment variables, and reduces resource usage

## Important Development Guidelines
- **Do NOT create separate `*-dev` targets** that bypass 1Password CLI
- **The `op run` approach is designed for both development AND production**
- **1Password CLI provides secure local testing** without hardcoded keys
- **All Turborepo tasks should use the same `op run --env-file=".env"` pattern**
- **This ensures consistency between development and deployment environments**

If you encounter 1Password CLI authentication issues:
1. Run `op signin` to authenticate
2. Verify your vault contains the referenced secret paths
3. Check that the `.env` file references match your 1Password structure
