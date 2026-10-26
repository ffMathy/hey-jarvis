---
paths:
  - "elevenlabs/**"
---

# Testing Guidelines

> Part of [ElevenLabs Integration](elevenlabs.md). Paths in it are relative to `elevenlabs/` unless they say otherwise.

## Where a test belongs

A spec that connects to ElevenLabs, brings up the tunnel or scores a real
conversation is named `*.integration.spec.ts` and runs under
`turbo test:integration`, which is the only target that resolves the credentials
above. A spec that only exercises the detectors keeps the plain `*.spec.ts`
suffix and runs under `turbo test`, which carries no secrets at all.

CI runs the offline half on every push. The live half never runs on GitHub
Actions — only when someone runs `turbo test:integration` by hand — so an eval
never spends quota unless someone asked it to.

## Test Score Requirements
All tests must use strict score requirements (>0.9 for 90%+ confidence):

```typescript
expect(result.passed).toBe(true);
expect(result.score).toBeGreaterThan(0.9);
```

## Mastra V1 Tool Message Format
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

## Example Test Structure
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
