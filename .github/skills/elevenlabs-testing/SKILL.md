---
name: elevenlabs-testing
description: Testing requirements for ElevenLabs voice integration. Use this when writing tests for ElevenLabs agents or voice interactions.
---

# ElevenLabs Testing Guidelines

Strict requirements for testing ElevenLabs voice agent behavior.

## Never Skip Tests

**CRITICAL**: Tests must NEVER be skipped in CI/CD environments. Let tests fail properly if requirements are not met.

## Test Score Requirements

All tests must use strict score requirements (>0.9 for 90%+ confidence):

```typescript
expect(result.passed).toBe(true);
expect(result.score).toBeGreaterThan(0.9);
```

❌ **NEVER** use lower thresholds like `> 0.8` or `> 0.7`
❌ **NEVER** skip tests with `.skip()` in production code

## Test Structure

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
  90000  // 90 second timeout
);
```

## Tool Message Format (Mastra V1)

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

## Test Categories

### Personality Tests
Verify agent personality traits:
- Addresses user as "sir"
- Uses J.A.R.V.I.S.-inspired wit and dry humor
- Brief, witty acknowledgements (5-15 words, max 20)

### Behavior Tests
Verify agent behavior patterns:
- Makes assumptions instead of asking clarifying questions
- Never follows up with questions
- Provides concise responses

### Tool Integration Tests
Verify tool usage:
- Correct tool selection
- Proper parameter passing
- Appropriate response to tool results

## LLM-Based Evaluation

Use the `testConversation.evaluate()` method:

```typescript
const result = await conversation.evaluate(
  'The agent provides a brief acknowledgement without asking questions'
);

// Always check both passed and score
expect(result.passed).toBe(true);
expect(result.score).toBeGreaterThan(0.9);
```

## Environment Variables

Required (via 1Password):
- `HEY_JARVIS_ELEVENLABS_API_KEY` - ElevenLabs API key
- `HEY_JARVIS_ELEVENLABS_AGENT_ID` - ElevenLabs agent ID
- `HEY_JARVIS_ELEVENLABS_VOICE_ID` - ElevenLabs voice ID
- `HEY_JARVIS_GOOGLE_API_KEY` - Google Gemini API for evaluations

## Timeouts

- Default test timeout: 90 seconds (90000ms)
- WebSocket connection timeout: 30 seconds
- Evaluation timeout: 60 seconds

## What NOT to Do

❌ Never skip tests with `.skip()`
❌ Never reduce score threshold below 0.9
❌ Never disable tests in CI/CD
❌ Never ignore test failures
❌ Never commit commented-out tests
