import { afterAll, beforeAll, describe, it } from 'bun:test';
import { startMcpServerForTestingPurposes, stopMcpServer } from '../../../mcp/tests/utils/mcp-server-manager.js';
import { deployTestAgent } from '../../src/main.js';
import type { ServerMessage } from '../utils/conversation-strategy.js';
import { reportMcpIntegrations } from '../utils/mcp-integration.js';
import { findSpokenToolCalls } from '../utils/spoken-tool-call.js';
import { TestConversation } from '../utils/test-conversation.js';
import { ensureTunnelRunning, stopTunnel } from '../utils/tunnel-manager.js';

const MAX_CONVERSATION_RETRIES = 3;

const CONVERSATION_TIMEOUT_MS = 90000;

/**
 * How long a tool call may take to surface after the agent has finished speaking.
 * The agent announces the routing before dispatching it, so the call itself lands
 * well after the conversation has gone quiet.
 */
const TOOL_CALL_TIMEOUT_MS = 90000;

/**
 * How long to wait before concluding that a tool was *not* called. An absence
 * only means something once a call has had time to appear, but there is no
 * event to wait for, so this is a flat window rather than a poll — kept far
 * shorter than TOOL_CALL_TIMEOUT_MS because every negative assertion waits it
 * out in full, whereas a positive one usually returns long before its deadline.
 */
const NO_TOOL_CALL_GRACE_MS = 20000;

const RELEVANT_TOOL_NAME_FRAGMENTS = ['weather', 'home_assistant', 'route'];

/** Message types that getTranscriptText already renders. */
const TRANSCRIPT_MESSAGE_TYPES = ['user_message', 'agent_response', 'agent_chat_response_part'];

function isRelevantToolName(toolName: string): boolean {
  const lowercased = toolName.toLowerCase();
  return RELEVANT_TOOL_NAME_FRAGMENTS.some((fragment) => lowercased.includes(fragment));
}

/** `routePromptWorkflow` — the one tool that hands a request off to the sub-agents. */
function isRoutingToolName(toolName: string): boolean {
  return toolName.toLowerCase().includes('route');
}

/**
 * Any of the MCP server's tools. It exposes exactly two — `routePromptWorkflow`
 * and `getNextInstructionsWorkflow` — and the second only ever follows the
 * first, so this is what "the agent delegated rather than answering" looks like.
 */
function isDelegationToolName(toolName: string): boolean {
  const lowercased = toolName.toLowerCase();
  return lowercased.includes('route') || lowercased.includes('instruction');
}

/**
 * Integrations the agent could not connect to, as it reported them.
 * With none connected the agent has no tools at all, and answers by writing
 * something that reads like a tool call into its own reply instead of making one.
 */
function findDisconnectedIntegrations(messages: ServerMessage[]): string[] {
  return messages
    .filter((message) => message.type === 'mcp_connection_status')
    .flatMap((message) => message.mcp_connection_status.integrations)
    .filter((integration) => !integration.is_connected)
    .map((integration) => `${integration.integration_id} (${integration.tool_count} tools)`);
}

/**
 * Everything the socket delivered that the transcript does not show — tool calls,
 * MCP connection status and anything else — so a missing tool call can be told
 * apart from one the agent never made.
 */
function describeNonTranscriptMessages(messages: ServerMessage[]): string {
  const details = messages
    .filter((message) => !TRANSCRIPT_MESSAGE_TYPES.includes(message.type))
    .map((message) => JSON.stringify(message).slice(0, 400));

  return details.length > 0 ? details.join('\n') : '(none)';
}

/**
 * An agent whose MCP server never connected has nothing to call, so say that
 * outright rather than waiting out the tool call timeout and reporting the
 * absence as if the agent had chosen not to call one.
 */
function assertMcpServerConnected(conversation: TestConversation): void {
  const disconnectedIntegrations = findDisconnectedIntegrations(conversation.getMessages());
  if (disconnectedIntegrations.length === 0) return;

  throw new Error(
    `The agent reported no connection to its MCP server, leaving it without tools: ` +
      `[${disconnectedIntegrations.join(', ')}]. ElevenLabs has to be able to reach the MCP server ` +
      `through the cloudflared tunnel for this test to mean anything.`,
  );
}

/** Everything the socket saw, for a failure message that can actually be diagnosed. */
function describeConversation(conversation: TestConversation, toolNames: string[]): string {
  const messages = conversation.getMessages();
  return (
    `All tool calls: [${toolNames.join(', ')}]\n` +
    `Message types received: [${messages.map((message) => message.type).join(', ')}]\n` +
    `Messages not in the transcript:\n${describeNonTranscriptMessages(messages)}\n` +
    `Transcript:\n${conversation.getTranscriptText()}`
  );
}

/**
 * Fails if the agent read its own plumbing out to the user. Worth asserting even
 * alongside assertToolCalled: reciting the call and making it are independent, and
 * an agent that does both still leaves sir listening to machinery.
 */
function assertNoSpokenToolCall(conversation: TestConversation): void {
  const spoken = findSpokenToolCalls(conversation.getMessages());
  if (spoken.length === 0) return;

  throw new Error(
    `The agent spoke its tooling aloud rather than leaving the tool call silent. ` +
      `Saying a tool's name does not call it — the words simply go to the speakers.\n` +
      `${spoken.join('\n')}\n\nTranscript:\n${conversation.getTranscriptText()}`,
  );
}

/** Waits for a matching tool call, and fails with the whole conversation if none arrives. */
async function assertToolCalled(
  conversation: TestConversation,
  matches: (toolName: string) => boolean,
  expectation: string,
): Promise<string[]> {
  assertMcpServerConnected(conversation);

  const toolNames = await conversation.waitForCalledToolNames(matches, TOOL_CALL_TIMEOUT_MS);
  if (toolNames.some(matches)) return toolNames;

  throw new Error(`${expectation}, but no such tool call was made.\n${describeConversation(conversation, toolNames)}`);
}

/** Gives a tool call time to appear, then fails if one did. */
async function assertToolNotCalled(
  conversation: TestConversation,
  matches: (toolName: string) => boolean,
  expectation: string,
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, NO_TOOL_CALL_GRACE_MS));

  const toolNames = await conversation.getCalledToolNames();
  const unexpected = toolNames.filter(matches);
  if (unexpected.length === 0) return;

  throw new Error(
    `${expectation}, but it called [${unexpected.join(', ')}].\n${describeConversation(conversation, toolNames)}`,
  );
}

/**
 * LLM-based conversation tests are inherently non-deterministic.
 * Retries the entire conversation flow (new connection each time)
 * to account for variance in both agent responses and evaluator scoring.
 */
async function withConversationRetry(
  createConversation: () => TestConversation,
  testBody: (conversation: TestConversation) => Promise<void>,
): Promise<void> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_CONVERSATION_RETRIES; attempt++) {
    const conversation = createConversation();
    let succeeded = false;
    try {
      await testBody(conversation);
      succeeded = true;
    } catch (error) {
      lastError = error as Error;
      console.warn(`⚠️ Attempt ${attempt}/${MAX_CONVERSATION_RETRIES} failed: ${lastError.message.split('\n')[0]}`);
    } finally {
      await conversation.disconnect();
    }
    if (succeeded) return;
  }
  throw lastError;
}

/**
 * Agent Prompt Specification Tests
 *
 * These tests verify that the ElevenLabs agent follows the specifications
 * defined in agent-prompt.md, including:
 * - Personality and tone (witty, dry humor, Victorian butler speak, slightly arrogant but impeccably loyal)
 * - Step-wise acknowledgements before tool calls
 * - Addressing user as "sir"
 * - No follow-up questions (making reasonable assumptions)
 * - Concise acknowledgements (5-15 words, hard cap 20)
 * - Teasing user inefficiencies while remaining charming and helpful
 */
describe('Agent Prompt Specifications', () => {
  // Non-null assertion safe here because beforeAll throws if these are undefined
  const agentId = process.env.HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID!;
  const apiKey = process.env.HEY_JARVIS_ELEVENLABS_API_KEY;
  const googleApiKey = process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY;

  // Order matters. ElevenLabs hosts the agent and reads its MCP tool list when
  // the agent is updated, so the server has to be answering on its public
  // hostname before the deploy — otherwise the agent is left holding
  // tool_count: 0 for a URL that only came alive afterwards.
  beforeAll(async () => {
    if (!process.env.HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID) {
      throw new Error('HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID environment variable is required');
    }
    await startMcpServerForTestingPurposes();
    await ensureTunnelRunning();
    await deployTestAgent();
    await reportMcpIntegrations();
    // The MCP server and cloudflared registering with Cloudflare's edge can each
    // take tens of seconds on a cold CI runner, before the deploy even starts.
  }, 240000);

  afterAll(() => {
    stopMcpServer();
    stopTunnel();
  });

  describe('Personality & Tone', () => {
    it(
      'should be condescending but remain loyal and helpful',
      async () => {
        await withConversationRetry(
          () => new TestConversation({ agentId, apiKey, googleApiKey }),
          async (conversation) => {
            await conversation.connect();
            await conversation.sendMessage('I need help with something');

            await conversation.assertCriteria(
              'The agent shows a condescending or superior tone (teasing inefficiencies) while still being helpful and demonstrating impeccable loyalty',
              0.9,
            );
          },
        );
      },
      CONVERSATION_TIMEOUT_MS * MAX_CONVERSATION_RETRIES,
    );
  });

  // The agent's whole purpose is to hand work to `routePromptWorkflow`, and there
  // are two observed ways it fails to. It can treat a witty "let me have a look" as
  // though the job were done, and stop — its licence to answer simple things itself,
  // spread to requests it cannot possibly answer. Or it can *say* the call instead of
  // making it, reciting `routePromptWorkflow(userQuery="...")` in the same breathless
  // voice as the rest of its reply. Both leave sir waiting on an answer that never
  // comes, so every eval here checks the transcript stayed clean of plumbing as well
  // as that the tool actually ran.
  describe('Tool Calling', () => {
    it(
      'should route a hesitantly phrased calendar request',
      async () => {
        await withConversationRetry(
          () => new TestConversation({ agentId, apiKey, googleApiKey }),
          async (conversation) => {
            await conversation.connect();
            // Verbatim from a real conversation. The agent replied "Naturally,
            // sir. Let me see what trivial engagements await you." and then
            // called nothing at all, leaving the promise unpaid. The filler
            // words are part of the case: this is how the request arrives from
            // speech, and a stumbling request is still a request.
            await conversation.sendMessage('Hey, Jarvis. Uh, could you, uh, check my calendar, please?');

            assertNoSpokenToolCall(conversation);
            await assertToolCalled(
              conversation,
              isRoutingToolName,
              'Expected the agent to hand the calendar request to routePromptWorkflow',
            );
          },
        );
      },
      (CONVERSATION_TIMEOUT_MS + TOOL_CALL_TIMEOUT_MS) * MAX_CONVERSATION_RETRIES,
    );

    it(
      'should call the tool silently rather than reciting it',
      async () => {
        await withConversationRetry(
          () => new TestConversation({ agentId, apiKey, googleApiKey }),
          async (conversation) => {
            await conversation.connect();
            // Verbatim from a real conversation. The agent gave its acknowledgement
            // and then said, out loud and in character,
            //   routePromptWorkflow(userQuery="Check my calendar for today")
            // having copied the shape of the worked example in the prompt instead of
            // performing what it depicts. No tool ran; the words just went to the
            // speakers.
            await conversation.sendMessage('Hey, Jarvis. Um, could you check my calendar for today?');

            // Checked before the tool-call wait so this exact failure is named
            // outright, rather than surfacing as a generic timeout 90 seconds later.
            assertNoSpokenToolCall(conversation);

            await assertToolCalled(
              conversation,
              isRoutingToolName,
              'Expected the agent to actually call routePromptWorkflow, not merely say it',
            );
          },
        );
      },
      (CONVERSATION_TIMEOUT_MS + TOOL_CALL_TIMEOUT_MS) * MAX_CONVERSATION_RETRIES,
    );

    it(
      'should keep a promise to check by making the call it promised',
      async () => {
        await withConversationRetry(
          () => new TestConversation({ agentId, apiKey, googleApiKey }),
          async (conversation) => {
            await conversation.connect();
            await conversation.sendMessage("What's on my calendar today?");

            assertNoSpokenToolCall(conversation);
            await assertToolCalled(
              conversation,
              isRoutingToolName,
              'Expected the agent to hand the calendar request to routePromptWorkflow',
            );

            // The tool call alone is not the whole contract: the transcript must
            // not read as an agent that announced a lookup and then went quiet.
            await conversation.assertCriteria(
              'The agent does not leave the user hanging on a bare promise. Either it reports something about the calendar, ' +
                'or its promise to go and look is followed in the transcript by a TOOL line showing the lookup actually happening. ' +
                'A transcript whose final agent message only promises to check, with no tool call after it, fails this criteria.',
              0.9,
            );
          },
        );
      },
      (CONVERSATION_TIMEOUT_MS + TOOL_CALL_TIMEOUT_MS) * MAX_CONVERSATION_RETRIES,
    );

    it(
      'should route a request about the house rather than inventing an answer',
      async () => {
        await withConversationRetry(
          () => new TestConversation({ agentId, apiKey, googleApiKey }),
          async (conversation) => {
            await conversation.connect();
            // Nothing in the prompt says which lights are on, so the only honest
            // reply is a routed one — an unrouted answer here is fabricated.
            await conversation.sendMessage('Are any of the lights still on downstairs?');

            assertNoSpokenToolCall(conversation);
            await assertToolCalled(
              conversation,
              isRelevantToolName,
              'Expected the agent to route a question it cannot answer from its own prompt',
            );
          },
        );
      },
      (CONVERSATION_TIMEOUT_MS + TOOL_CALL_TIMEOUT_MS) * MAX_CONVERSATION_RETRIES,
    );

    // The other half of the rule, and the reason it is easy to get wrong in the
    // other direction: pushing the agent to route more must not make it route
    // the things it is supposed to answer on the spot.
    it(
      'should answer from its own prompt without routing',
      async () => {
        await withConversationRetry(
          () => new TestConversation({ agentId, apiKey, googleApiKey }),
          async (conversation) => {
            await conversation.connect();
            await conversation.sendMessage('What is your name?');

            assertNoSpokenToolCall(conversation);
            await assertToolNotCalled(
              conversation,
              isDelegationToolName,
              'Expected the agent to state its own name outright rather than delegating it',
            );

            await conversation.assertCriteria(
              'The agent states its own name — Jarvis — directly in its reply, rather than deferring, ' +
                'promising to find out, or explaining that it cannot say.',
              0.9,
            );
          },
        );
      },
      (CONVERSATION_TIMEOUT_MS + NO_TOOL_CALL_GRACE_MS) * MAX_CONVERSATION_RETRIES,
    );
  });

  describe('No Follow-up Questions', () => {
    it(
      'should call weather tools when asking about weather',
      async () => {
        await withConversationRetry(
          () => new TestConversation({ agentId, apiKey, googleApiKey }),
          async (conversation) => {
            await conversation.connect();
            // Request that implies tool usage but is vague about details
            await conversation.sendMessage("What's the weather like right now?");

            // Verify a tool was called — the agent may call weather tools directly
            // or use the routePromptWorkflow which internally dispatches to weather.
            await assertToolCalled(
              conversation,
              isRelevantToolName,
              'Expected a weather, home assistant, or routing tool to be called',
            );

            // Then verify no follow-up questions using LLM evaluation
            await conversation.assertCriteria(
              'The agent makes a reasonable assumption (e.g., assumes a location such as the current location) OR provides a response without asking the user for clarification or more information',
              0.9,
            );
          },
        );
      },
      // This is one of the tests that also waits on a tool call, so it needs that
      // budget on top of the conversation's.
      (CONVERSATION_TIMEOUT_MS + TOOL_CALL_TIMEOUT_MS) * MAX_CONVERSATION_RETRIES,
    );

    it(
      'should not ask questions when request is ambiguous',
      async () => {
        await withConversationRetry(
          () => new TestConversation({ agentId, apiKey, googleApiKey }),
          async (conversation) => {
            await conversation.connect();
            await conversation.sendMessage('What should I do today?');

            await conversation.assertCriteria(
              'The agent provides a response OR suggestions without explicitly asking follow-up questions like "What are you interested in?" or "What would you like to know?" or "What do you mean?"',
              0.9,
            );
          },
        );
      },
      CONVERSATION_TIMEOUT_MS * MAX_CONVERSATION_RETRIES,
    );
  });

  describe('Conciseness & Clarity', () => {
    it(
      'should provide concise responses without unnecessary verbosity',
      async () => {
        await withConversationRetry(
          () => new TestConversation({ agentId, apiKey, googleApiKey }),
          async (conversation) => {
            await conversation.connect();
            await conversation.sendMessage('What time is it?');

            await conversation.assertCriteria(
              'The agent provides a concise, direct response without excessive explanation or rambling. The response should be brief (under 30 words) and to the point.',
              0.5,
            );
          },
        );
      },
      CONVERSATION_TIMEOUT_MS * MAX_CONVERSATION_RETRIES,
    );

    it(
      'should use Victorian butler speak with personality',
      async () => {
        await withConversationRetry(
          () => new TestConversation({ agentId, apiKey, googleApiKey }),
          async (conversation) => {
            await conversation.connect();
            await conversation.sendMessage('Hello!');
            await conversation.sendMessage('How can you help me?');

            await conversation.assertCriteria(
              'The agent uses a formal, butler-like or distinguished servant speaking style. It addresses the user respectfully (e.g., "sir") and uses elevated, sophisticated language rather than casual modern slang.',
              0.7,
            );
          },
        );
      },
      CONVERSATION_TIMEOUT_MS * MAX_CONVERSATION_RETRIES,
    );
  });

  describe('Tone Appropriateness', () => {
    it(
      'should tease user inefficiencies while remaining charming',
      async () => {
        await withConversationRetry(
          () => new TestConversation({ agentId, apiKey, googleApiKey }),
          async (conversation) => {
            await conversation.connect();
            await conversation.sendMessage('I made a mistake earlier');

            await conversation.assertCriteria(
              'The agent teases the user about the mistake with a slightly superior tone but remains impeccably loyal, helpful, and charming (not genuinely mean)',
              0.9,
            );
          },
        );
      },
      CONVERSATION_TIMEOUT_MS * MAX_CONVERSATION_RETRIES,
    );
  });
});
