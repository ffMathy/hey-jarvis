---
paths:
  - "elevenlabs/**"
---

# ElevenLabs Integration

> Paths in this rule are relative to `elevenlabs/` unless they say otherwise.

## Its rules

Each topic is a rule of its own, under the same paths:

- [File Structure](elevenlabs-file-structure.md)
- [Testing Guidelines](elevenlabs-testing-guidelines.md)
- [Agent Prompt Requirements](elevenlabs-agent-prompt-requirements.md)
- [What a client is allowed to override](elevenlabs-what-a-client-is-allowed-to-override.md)
- [The Realtime model](elevenlabs-the-realtime-model.md)
- [The conversational model](elevenlabs-the-conversational-model.md)
- [Hanging up when he goes quiet](elevenlabs-hanging-up-when-he-goes-quiet.md)
- [Showing Jarvis something](elevenlabs-showing-jarvis-something.md)
- [The headset](elevenlabs-the-headset.md)

## Overview
TypeScript-based integration connecting ElevenLabs voice AI agents with the Hey Jarvis ecosystem.

## Key Features
- **ElevenLabs Agent Integration**: WebSocket-based real-time conversation
- **Personality-Driven Prompts**: J.A.R.V.I.S.-inspired witty, loyal AI assistant
- **LLM-Based Testing**: Automated evaluation using Gemini models
- **Agent Configuration Deployment**: Programmatic updating of ElevenLabs configs

## TURBO Commands
```bash
bunx turbo test --filter=elevenlabs     # Run the offline tests
bunx turbo test:integration --filter=elevenlabs  # Run the live conversation evals
bunx turbo build --filter=elevenlabs    # Build the project
bunx turbo deploy --filter=elevenlabs   # Update ElevenLabs agent configuration
bun run --cwd elevenlabs refresh  # Fetch current agent configuration
bunx turbo lint --filter=elevenlabs     # Lint the project
```

## Environment Variables
Required (via 1Password):
- `HEY_JARVIS_ELEVENLABS_API_KEY` - ElevenLabs API key
- `HEY_JARVIS_ELEVENLABS_AGENT_ID` - ElevenLabs agent ID
- `HEY_JARVIS_ELEVENLABS_VOICE_ID` - ElevenLabs voice ID
- `HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY` - Google Gemini API for test evaluations

Optional (via `op.optional.env`):
- `HEY_JARVIS_ELEVENLABS_POST_CALL_WEBHOOK_ID` - the workspace webhook `deploy` links the production
  agent's post-call webhook to. See **Fixing failed evaluations** below

## The voice model

`conversationConfig.tts.modelId` is `eleven_v4_turbo`, Eleven v4 Turbo: the low-latency variant of
Eleven v4 that ElevenAgents recommends for live conversation. It keeps the audio tags
(`suggestedAudioTags`) the prompt relies on, as `eleven_v3_conversational` did before it.

The SDK lags the API here. `@elevenlabs/elevenlabs-js` validates the request against enums frozen at
its release, and no published version lists `eleven_v4_turbo` yet, so a plain `agents.update` throws
`Expected enum` before sending anything. `deployConfig` therefore serializes `conversationConfig`
itself through `toConversationConfigBody`, which lets unknown enum values through, and sends it as an
additional body parameter. Once the SDK knows the model the workaround is harmless; keep it anyway,
because the next model will outrun the SDK the same way.

## Fixing failed evaluations

ElevenLabs scores every conversation against `platformSettings.evaluation.criteria` in
`src/assets/agent-config.json`, and the production agent's post-call webhook sends the transcript and
those results to the MCP server. A conversation that failed a criterion has a Claude Code session started
on it, which finds the cause, fixes it and opens a pull request — see "Fixing Failed ElevenLabs
Evaluations" in `.claude/rules/mcp.md`. So a criterion here is also a standing request for a fix whenever it
fails: word it as something the agent can be changed to pass.

`deploy` links the webhook only when `HEY_JARVIS_ELEVENLABS_POST_CALL_WEBHOOK_ID` is set, and never on the
test agent, whose conversations are the integration specs'. `tests/specs/post-call-webhook.spec.ts`
checks the link, and that the agent still sends `transcript` events and has a criterion to report on.

## Contributing
- **Update agent-prompt.md** for behavior changes
- **Add tests** with 0.9+ score requirements for new features
- **Test locally** before deploying to ElevenLabs
- **Use `bunx turbo deploy --filter=elevenlabs`** to push prompt changes

## Scope Guidelines for Commits
Use elevenlabs-specific scopes:
- `elevenlabs`, `voice`, `agent`
- `tests`, `prompt`, `config`
