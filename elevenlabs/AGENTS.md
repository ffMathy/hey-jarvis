# ElevenLabs Integration Agents

## Overview
This project provides integration with ElevenLabs Conversational AI platform, enabling voice-based interactions with the Hey Jarvis assistant.

## Project Description
A TypeScript-based integration that connects ElevenLabs voice AI agents with the Hey Jarvis ecosystem, providing natural voice conversations with personality-driven responses.

## Key Features
- **ElevenLabs Agent Integration**: WebSocket-based real-time conversation with ElevenLabs agents
- **Personality-Driven Prompts**: J.A.R.V.I.S.-inspired witty, loyal, and sophisticated AI assistant
- **LLM-Based Testing**: Automated evaluation of agent behavior using Gemini models
- **Agent Configuration Deployment**: Programmatic updating of ElevenLabs agent configurations

## Testing Guidelines

### Test Score Requirements

**CRITICAL**: All tests must use strict score requirements to ensure high-quality agent behavior:

#### ✅ CORRECT Test Assertions:
```typescript
// For tests that should pass with high confidence
expect(result.passed).toBe(true);
expect(result.score).toBeGreaterThan(0.9);  // Require >90% confidence
```

#### ❌ INCORRECT Test Assertions:
```typescript
// NEVER use these lenient checks
expect(result.score).toBeGreaterThanOrEqual(0);  // ❌ Too lenient!
expect(result.score).toBeGreaterThan(0.5);       // ❌ Too low!
expect(result.score).toBeGreaterThan(0.6);       // ❌ Still too low!
```

#### 🎯 Score Threshold Guidelines:
- **Standard tests**: `> 0.9` (90%+ confidence required)
- **Only use lower thresholds** when explicitly justified (e.g., highly subjective personality traits)
- **Never use `>= 0`** - this accepts any response including complete failures
- **Document exceptions**: If a test needs <0.9, add a comment explaining why

### Evaluation Best Practices

The `TestConversation.evaluate()` method automatically:
- ✅ **Evaluates the FULL conversation transcript** (not just the last message)
- ✅ Uses semantic understanding via LLM evaluation
- ✅ Provides reasoning for pass/fail decisions
- ✅ Returns confidence scores (0-1 range)

When writing test criteria:
1. **Be specific**: "Agent addresses user as 'sir'" not "Agent is polite"
2. **Be measurable**: Criteria should have clear success conditions
3. **Consider context**: Evaluation looks at the whole conversation flow
4. **Expect excellence**: Default to 0.9+ score requirements

### Example Test Structure

```typescript
runTest(
  'should address the user as "sir"',
  async () => {
    await conversation.connect();
    await conversation.sendMessage('Hello, how are you?');

    const result = await conversation.evaluate(
      'The agent addresses the user as "sir" at least once in the conversation'
    );

    console.log('Addressing as "sir" evaluation:', result);
    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThan(0.9);  // High bar for quality
  },
  90000
);
```

## Agent Prompt Requirements

The agent prompt in `src/assets/agent-prompt.md` defines:
- **Personality**: J.A.R.V.I.S.-inspired wit, dry humor, condescending but loyal
- **Addressing**: Always call the user "sir"
- **No Follow-ups**: Make assumptions rather than asking clarifying questions
- **Conciseness**: Brief, witty acknowledgements (5-15 words, max 20)
- **Step-wise Acknowledgements**: Before every tool call, provide a witty one-sentence summary

## Development Commands

### NX Commands
**CRITICAL: ALWAYS use NX commands** for this monorepo:
- ✅ Use `nx test elevenlabs` instead of `npm test`
- ✅ Use `nx build elevenlabs` instead of `npm run build`
- ✅ Use `nx deploy elevenlabs` to update ElevenLabs agent configuration
- ✅ Use `nx refresh elevenlabs` to fetch current agent configuration
- ❌ **NEVER use `npm run` commands** in this NX monorepo

### Environment Setup

This project uses **1Password CLI** for secure environment variable management:

#### Required Environment Variables
- `HEY_JARVIS_ELEVENLABS_API_KEY` - ElevenLabs API key
- `HEY_JARVIS_ELEVENLABS_AGENT_ID` - ElevenLabs agent ID
- `HEY_JARVIS_ELEVENLABS_VOICE_ID` - ElevenLabs voice ID
- `HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY` - Google Gemini API for test evaluations

#### 1Password Setup
1. **Sign in**: `op signin` (or `eval $(op signin -f)`)
2. **Verify**: `op whoami`
3. **Run tests**: `nx test elevenlabs` (automatically uses `op run`)

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

## Integration Capabilities

### ElevenLabs Conversational AI
- Real-time voice conversations via WebSocket
- Agent configuration management via API
- Text-to-speech with customizable voices
- Conversational context and memory

### Test Automation
- LLM-powered evaluation of agent responses
- Full transcript analysis for context-aware testing
- Personality and tone verification
- Conversation coherence validation

## Contributing

When modifying this project:
- **Update agent-prompt.md** for behavior changes
- **Add tests** with 0.9+ score requirements for new features
- **Test locally** before deploying to ElevenLabs
- **Use `nx deploy elevenlabs`** to push prompt changes to production
- **Follow NX commands** exclusively (no direct npm commands)

## Future Enhancements

- Integration with Hey Jarvis MCP agents
- Multi-turn conversation state management
- Voice activity detection improvements
- Custom evaluation scorers for domain-specific testing
