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

### Never Skip Tests

**CRITICAL**: Tests must NEVER be skipped in CI/CD environments:

- ❌ **NEVER** add logic to skip tests when credentials are missing
- ❌ **NEVER** exit with code 0 when tests should fail due to missing credentials
- ✅ **ALWAYS** let tests fail properly if requirements are not met
- ✅ **ALWAYS** ensure required credentials are available in CI/CD pipelines

**Rationale**: Skipping tests silently hides problems. If tests can't run due to missing credentials, the build should fail to alert developers that the environment is not properly configured.

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

### Mastra V1 Tool Message Format

**CRITICAL**: When sending tool results to agents, use the proper Mastra V1 message format:

```typescript
const message = {
    createdAt: new Date(),
    id: 'unique-id',
    content: 'tool result content',  // REQUIRED: Must not be null/undefined
    role: 'tool',
    type: 'tool-result',  // REQUIRED for tool messages
};
```

**Key Requirements**:
- ✅ Tool messages **MUST** have `type: 'tool-result'`
- ✅ Tool messages **MUST** have `content` property that is non-null (empty strings allowed)
- ✅ OR tool messages can use `parts` array instead of `content`
- ❌ **NEVER** set `type: 'text'` for tool role messages
- ❌ **NEVER** pass null/undefined as content

**Example Error**:
```
Message with role "tool" must have either a 'content' property (string or array) 
or a 'parts' property (array) that is not empty, null, or undefined.
```

This validation is enforced by Mastra V1 beta in `message-list/index.js`.

### Tool Call Verification

When testing tool-calling behavior:

1. **Direct Message Inspection**: Check message history for actual tool calls
```typescript
const messages = conversation.getMessages();
const toolCalls = messages.filter(
  (msg) => msg.type === 'mcp_tool_call' && 
  msg.mcp_tool_call.tool_name.toLowerCase().includes('weather')
);

if (toolCalls.length === 0) {
  throw new Error('Expected weather tool to be called');
}
```

2. **LLM Evaluation**: Use for semantic verification of behavior
```typescript
await conversation.assertCriteria(
  'The agent makes reasonable assumptions without asking follow-up questions',
  0.9
);
```

**NEVER** use workarounds - always fix root causes properly and document requirements.

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

## Development Guidelines

### Code Quality Principles

**CRITICAL: ALWAYS follow these principles:**

#### DRY (Don't Repeat Yourself)
- ✅ **Extract repeated code into reusable functions**
- ✅ **Create helper methods for common patterns** (e.g., ServerMessage creation)
- ❌ **NEVER copy-paste code blocks** - refactor into functions instead
- ❌ **NEVER duplicate logic** - centralize common functionality

#### Clean Code
- ✅ **Single Responsibility**: Each function should do one thing well
- ✅ **Descriptive Names**: Use clear, self-documenting function/variable names
- ✅ **Small Functions**: Keep functions focused and concise
- ✅ **Avoid Magic Numbers**: Use named constants for clarity

#### Example: Bad vs Good

❌ **BAD - Repeated Code:**
```typescript
// Creating messages multiple times
const msg1 = { type: 'agent_response', agent_response_event: { agent_response: text1 } };
const msg2 = { type: 'agent_response', agent_response_event: { agent_response: text2 } };
const msg3 = { type: 'agent_response', agent_response_event: { agent_response: text3 } };
```

✅ **GOOD - DRY with Helper Function:**
```typescript
private createAgentResponseMessage(responseText: string): ServerMessage {
    return {
        type: 'agent_response',
        agent_response_event: { agent_response: responseText },
    };
}

const msg1 = this.createAgentResponseMessage(text1);
const msg2 = this.createAgentResponseMessage(text2);
const msg3 = this.createAgentResponseMessage(text3);
```

## Development Commands

### NX Commands
**CRITICAL: ALWAYS use NX commands** for this monorepo:
- ✅ Use `nx test elevenlabs` instead of running test directly
- ✅ Use `nx build elevenlabs` instead of running build directly
- ✅ Use `nx deploy elevenlabs` to update ElevenLabs agent configuration
- ✅ Use `nx refresh elevenlabs` to fetch current agent configuration
- ❌ **NEVER use npm commands** in this Bun-powered monorepo

### Environment Setup

This project uses **1Password CLI** for secure environment variable management:

#### Required Environment Variables
- `HEY_JARVIS_ELEVENLABS_API_KEY` - ElevenLabs API key
- `HEY_JARVIS_ELEVENLABS_AGENT_ID` - ElevenLabs agent ID
- `HEY_JARVIS_ELEVENLABS_VOICE_ID` - ElevenLabs voice ID
- `HEY_JARVIS_GOOGLE_API_KEY` - Google Gemini API for test evaluations

#### 1Password Setup
1. **Sign in**: `eval $(op signin)` - **CRITICAL: Always run this command when you get a 1Password authentication error or non-zero exit code from op commands**
2. **Verify**: `op whoami`
3. **Run tests**: `nx test elevenlabs` (automatically uses `op run`)

**Important**: 
- If any command using 1Password fails with "no active session found" or similar errors, immediately run `eval $(op signin)` to re-authenticate before continuing.
- **After running `eval $(op signin)`, always assume it succeeded regardless of what output it returns.** It typically returns no output when successful.

#### Terminal Session Management
**CRITICAL: Always reuse existing terminal sessions** when running commands:
- Check `get_terminal_output` to see what terminals are available
- Reuse the same terminal ID for related commands instead of creating new terminals
- This maintains context, environment variables, and reduces resource usage

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
- **Follow NX commands** exclusively (no direct package manager commands)

### Commit Message Standards

**CRITICAL: ALWAYS follow Conventional Commits** for all commit messages:

#### Format
```
<type>(<scope>): <subject>

<body>

<footer>
```

#### Required Components
- **type**: Category of the change (REQUIRED)
- **scope**: Component affected (optional but recommended)
- **subject**: Brief description (REQUIRED, lowercase, no period)
- **body**: Detailed explanation (optional)
- **footer**: Breaking changes, issue references (optional)

#### Commit Types
- **feat**: New feature for the user
- **fix**: Bug fix for the user
- **docs**: Documentation only changes
- **style**: Formatting, missing semicolons, etc. (no code change)
- **refactor**: Code change that neither fixes a bug nor adds a feature
- **perf**: Performance improvement
- **test**: Adding or refactoring tests
- **chore**: Maintenance tasks, dependency updates
- **build**: Build system or external dependency changes
- **ci**: CI configuration changes

#### Examples
```bash
# Feature addition
feat(voice): add emotion detection to responses

# Bug fix with scope
fix(tests): correct evaluation score thresholds

# Documentation update
docs(prompt): update personality guidelines

# Breaking change
feat(api)!: change websocket connection method

BREAKING CHANGE: WebSocket now requires authentication token
```

#### Scope Guidelines
Use project names or component names:
- `elevenlabs`, `voice`, `agent`
- `tests`, `prompt`, `config`
- `build`, `ci`, `deps`

#### Best Practices
- Keep subject line under 72 characters
- Use imperative mood ("add" not "added")
- Don't capitalize first letter of subject
- No period at end of subject
- Use body to explain "what" and "why" vs. "how"
- Reference issues in footer: `Closes #123`

## Future Enhancements

- Integration with Hey Jarvis MCP agents
- Multi-turn conversation state management
- Voice activity detection improvements
- Custom evaluation scorers for domain-specific testing
