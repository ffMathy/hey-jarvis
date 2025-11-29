# ElevenLabs Integration

> **Note:** See the root [AGENTS.md](../AGENTS.md) for shared conventions (NX commands, commit standards, 1Password, etc.)

## Overview
TypeScript-based integration connecting ElevenLabs voice AI agents with the Hey Jarvis ecosystem.

## Key Features
- **ElevenLabs Agent Integration**: WebSocket-based real-time conversation
- **Personality-Driven Prompts**: J.A.R.V.I.S.-inspired witty, loyal AI assistant
- **LLM-Based Testing**: Automated evaluation using Gemini models
- **Agent Configuration Deployment**: Programmatic updating of ElevenLabs configs

## File Structure
```
elevenlabs/
├── src/
│   ├── main.ts                      # Main entry point for CLI operations
│   ├── assets/
│   │   ├── agent-config.json        # ElevenLabs agent configuration
│   │   └── agent-prompt.md          # Agent personality and behavior prompt
│   └── test-utils/
│       ├── test-conversation.ts     # LLM-based test evaluation framework
│       ├── websocket-client.ts      # ElevenLabs WebSocket client
│       └── agent-prompt.spec.ts     # Agent behavior specification tests
├── AGENTS.md                        # This file
├── project.json                     # NX project configuration
└── op.env                          # 1Password environment variable references
```

## NX Commands
```bash
bunx nx test elevenlabs     # Run tests
bunx nx build elevenlabs    # Build the project
bunx nx deploy elevenlabs   # Update ElevenLabs agent configuration
bunx nx refresh elevenlabs  # Fetch current agent configuration
bunx nx lint elevenlabs     # Lint the project
```

## Environment Variables
Required (via 1Password):
- `HEY_JARVIS_ELEVENLABS_API_KEY` - ElevenLabs API key
- `HEY_JARVIS_ELEVENLABS_AGENT_ID` - ElevenLabs agent ID
- `HEY_JARVIS_ELEVENLABS_VOICE_ID` - ElevenLabs voice ID
- `HEY_JARVIS_GOOGLE_API_KEY` - Google Gemini API for test evaluations

## Testing Guidelines

### Never Skip Tests
**CRITICAL**: Tests must NEVER be skipped in CI/CD environments. Let tests fail properly if requirements are not met.

### Test Score Requirements
All tests must use strict score requirements (>0.9 for 90%+ confidence):

```typescript
expect(result.passed).toBe(true);
expect(result.score).toBeGreaterThan(0.9);
```

### Mastra V1 Tool Message Format
When sending tool results to agents:
```typescript
const message = {
    createdAt: new Date(),
    id: 'unique-id',
    content: 'tool result content',  // REQUIRED
    role: 'tool',
    type: 'tool-result',  // REQUIRED
};
```

### Example Test Structure
```typescript
runTest(
  'should address the user as "sir"',
  async () => {
    await conversation.connect();
    await conversation.sendMessage('Hello, how are you?');
    const result = await conversation.evaluate(
      'The agent addresses the user as "sir" at least once'
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThan(0.9);
  },
  90000
);
```

## Agent Prompt Requirements

The agent prompt in `src/assets/agent-prompt.md` defines:
- **Personality**: J.A.R.V.I.S.-inspired wit, dry humor
- **Addressing**: Always call the user "sir"
- **No Follow-ups**: Make assumptions rather than asking clarifying questions
- **Conciseness**: Brief, witty acknowledgements (5-15 words, max 20)

## Contributing
- **Update agent-prompt.md** for behavior changes
- **Add tests** with 0.9+ score requirements for new features
- **Test locally** before deploying to ElevenLabs
- **Use `bunx nx deploy elevenlabs`** to push prompt changes

## Scope Guidelines for Commits
Use elevenlabs-specific scopes:
- `elevenlabs`, `voice`, `agent`
- `tests`, `prompt`, `config`
