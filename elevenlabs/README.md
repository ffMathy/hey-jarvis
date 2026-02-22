# ElevenLabs Agent Deployer

CLI tool for deploying and testing the Jarvis ElevenLabs voice agent from code.

## Quick Start

```bash
bunx nx deploy elevenlabs        # Deploy to ElevenLabs (production)
bunx nx deploy:test elevenlabs   # Deploy test agent (text-only mode)
bunx nx refresh elevenlabs       # Fetch current config from ElevenLabs
bunx nx test elevenlabs          # Run tests (auto-deploys test agent first)
```

## How It Works

The agent configuration is split into two files:

| File | Content |
|------|---------|
| `src/assets/agent-prompt.md` | Jarvis personality — witty, condescending butler from Iron Man |
| `src/assets/agent-config.json` | ElevenLabs technical config (voice, model, conversation settings) |

On **deploy**, the CLI combines these files, injects agent/voice IDs from environment variables, and updates the agent via the ElevenLabs API.

On **fetch**, the CLI retrieves the current config and automatically strips sensitive data (phone numbers, IDs, access info, webhook URLs) before saving.

## Testing

Tests use **LLM-based evaluation** — the suite has live conversations with the deployed agent and uses Gemini to score responses for personality, tone, and correctness.

1. Deploys the test agent (text-only mode, separate MCP server)
2. Starts an MCP server + Cloudflare tunnel
3. Sends conversation prompts via WebSocket
4. Gemini evaluates responses (threshold: score > 0.9)
5. Retries up to 3 times for LLM non-determinism

## Security

- **Filtered on fetch**: phone numbers, agent/voice IDs, access info, webhook URLs, metadata
- **Injected on deploy**: agent ID and voice ID from environment variables (never stored on disk)

## Environment

Managed via 1Password CLI:

- `HEY_JARVIS_ELEVENLABS_API_KEY` — API authentication
- `HEY_JARVIS_ELEVENLABS_AGENT_ID` — Production agent
- `HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID` — Test agent
- `HEY_JARVIS_ELEVENLABS_VOICE_ID` — Voice for TTS
- `HEY_JARVIS_GOOGLE_API_KEY` — Gemini for test evaluation
