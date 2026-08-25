# ElevenLabs Integration

> **Note:** See the root [AGENTS.md](../AGENTS.md) for shared conventions (Turborepo commands, commit standards, 1Password, etc.)

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
│   └── assets/
│       ├── agent-config.json        # ElevenLabs agent configuration
│       └── agent-prompt.md          # Agent personality and behavior prompt
├── tests/
│   ├── specs/                       # Agent behavior specification tests
│   ├── utils/                       # Conversation framework, tunnel, MCP helpers
│   └── README.md                    # How the tests are wired together
├── AGENTS.md                        # This file
├── package.json                     # Project scripts, run through Turborepo
└── op.env                           # 1Password environment variable references
```

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

## Testing Guidelines

### Where a test belongs

A spec that connects to ElevenLabs, brings up the tunnel or scores a real
conversation is named `*.integration.spec.ts` and runs under
`turbo test:integration`, which is the only target that resolves the credentials
above. A spec that only exercises the detectors keeps the plain `*.spec.ts`
suffix and runs under `turbo test`, which carries no secrets at all.

CI runs the offline half on every push and the live half only once the pull
request is out of draft — so an eval never spends quota on work in progress.

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
- **When to reach for a tool**: answer outright or route, and never both
- **Analysis Mode**: the bare word "analysis" drops the persona for a flat,
  robot-like step-by-step readout of the conversation and the tool calls in it
- **Ending the call**: a closing line in character, then the `end_call` tool — a
  written "[end_call invoked]" is a stage direction, not a call, and leaves the
  line open

Keep it short. The prompt is carried by a small voice model on every turn, so
anything it does not need in order to decide its *next* utterance does not
belong in it.

### What belongs in the routing instructions instead

Every response from `routePromptWorkflow` and `getNextInstructionsWorkflow`
carries an `instructions` field, and the prompt's only rule about the loop is
to follow that field literally. So the run-time mechanics — how long to keep
polling, what to say between reports, what to do with a failed call, that a
finished request does not finish the conversation — live in `INSTRUCTIONS` and
`ALL_TASKS_COMPLETED_INSTRUCTIONS` in
[`mcp/mastra/verticals/routing/workflows.ts`](../mcp/mastra/verticals/routing/workflows.ts),
where they arrive exactly when they apply.

State each such rule in one place only. Asking for the same line here *and*
there is how Jarvis once acknowledged the same request twice.

## Contributing
- **Update agent-prompt.md** for behavior changes
- **Add tests** with 0.9+ score requirements for new features
- **Test locally** before deploying to ElevenLabs
- **Use `bunx turbo deploy --filter=elevenlabs`** to push prompt changes

## Scope Guidelines for Commits
Use elevenlabs-specific scopes:
- `elevenlabs`, `voice`, `agent`
- `tests`, `prompt`, `config`
