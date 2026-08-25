import { afterAll, beforeAll, describe, it } from 'bun:test';
import { assertMcpServerConnected } from '../utils/mcp-connection.js';
import { TestConversation } from '../utils/test-conversation.js';
import {
  startTestEnvironment,
  stopTestEnvironment,
  TEST_ENVIRONMENT_SETUP_TIMEOUT_MS,
} from '../utils/test-environment.js';

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

/**
 * The long back-and-forth eval's turns, each a request that cannot be answered
 * without a tool. Declared here so the test's timeout scales with the list
 * rather than with a number kept in step by hand.
 */
const LONG_CONVERSATION_REQUESTS = [
  'Could you check my calendar for today?',
  "And what's the weather like right now?",
  'Are any lights still on downstairs?',
  "What's on my shopping list?",
  'Anything on my calendar tomorrow?',
];

const RELEVANT_TOOL_NAME_FRAGMENTS = ['weather', 'home_assistant', 'route'];

function isRelevantToolName(toolName: string): boolean {
  const lowercased = toolName.toLowerCase();
  return RELEVANT_TOOL_NAME_FRAGMENTS.some((fragment) => lowercased.includes(fragment));
}

/** `routePromptWorkflow` — the one tool that hands a request off to the sub-agents. */
function isRoutingToolName(toolName: string): boolean {
  return toolName.toLowerCase().includes('route');
}

/** `end_call` — the system tool that hangs up. */
function isEndCallToolName(toolName: string): boolean {
  return toolName.toLowerCase().includes('end_call');
}

/**
 * Polls until the agent has invoked a matching system tool, or the window closes.
 * Hanging up follows the closing line rather than replacing it, so reading the
 * absence too early would only mean the reply had not finished yet.
 */
async function waitForSystemToolCall(
  conversation: TestConversation,
  matches: (toolName: string) => boolean,
): Promise<string[]> {
  const deadline = Date.now() + NO_TOOL_CALL_GRACE_MS;
  let toolNames = conversation.getInvokedSystemToolNames();

  while (!toolNames.some(matches) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    toolNames = conversation.getInvokedSystemToolNames();
  }

  return toolNames;
}

/**
 * Waits for a matching tool call, so the evidence is complete by the time it is
 * judged. Synchronisation, not assertion — whether the call *should* have been
 * made is the evaluator's to score, and it returns quietly either way.
 */
async function settleAfterRouting(
  conversation: TestConversation,
  matches: (toolName: string) => boolean,
): Promise<void> {
  assertMcpServerConnected(conversation.getMessages());
  await conversation.waitForCalledToolNames(matches, TOOL_CALL_TIMEOUT_MS);
}

/**
 * Gives a tool call time to appear where the point is that none should. Without
 * the wait, an absence would only mean the test asked too early.
 */
async function settleWithoutRouting(conversation: TestConversation): Promise<void> {
  assertMcpServerConnected(conversation.getMessages());
  await new Promise((resolve) => setTimeout(resolve, NO_TOOL_CALL_GRACE_MS));
}

/**
 * Polls until the agent has made a tool call it had not made before, so a later
 * turn does not settle on its predecessors' calls.
 */
async function waitForToolCallsBeyond(conversation: TestConversation, baseline: number): Promise<string[]> {
  const deadline = Date.now() + TOOL_CALL_TIMEOUT_MS;
  let toolNames = await conversation.getCalledToolNames();

  while (toolNames.length <= baseline && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    toolNames = await conversation.getCalledToolNames();
  }

  return toolNames;
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
 * - Stepping out of character for a flat, diagnostic readout when told "analysis"
 * - Hanging up through the end_call tool rather than narrating it
 */
describe('Agent Prompt Specifications', () => {
  // Non-null assertion safe here because beforeAll throws if these are undefined
  const agentId = process.env.HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID!;
  const apiKey = process.env.HEY_JARVIS_ELEVENLABS_API_KEY;
  const googleApiKey = process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY;

  beforeAll(startTestEnvironment, TEST_ENVIRONMENT_SETUP_TIMEOUT_MS);

  // Awaited, so the server and tunnel are down before the next spec file starts
  // its own. Firing this and moving on left the teardown to shoot the next
  // file's server the moment it came up.
  afterAll(stopTestEnvironment);

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
  // comes, so every eval here requires a clean transcript as well as a tool that ran.
  //
  // Every one of them is settled by scoring rather than by a thrown assertion. Each
  // waits for the conversation to finish moving, then hands the evaluator both the
  // transcript and the evidence read off the connection — the tool calls, what was
  // spoken, in what order — and asserts on the score it returns. The mechanical
  // detectors still do the seeing; the model only does the judging.
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

            await settleAfterRouting(conversation, isRoutingToolName);

            await conversation.assertCriteria(
              'The agent handed the calendar request to its routing tool. The evidence must show at least one ' +
                'tool call whose name contains "route", and no tool names spoken aloud. The filler words in the ' +
                'request do not make it any less of an instruction: a stumbling "uh, could you, uh, check my ' +
                'calendar" is to be acted on exactly like a crisp one.',
              0.9,
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

            await settleAfterRouting(conversation, isRoutingToolName);

            await conversation.assertCriteria(
              'The agent called its routing tool for real and said nothing of it aloud. The evidence must show ' +
                'at least one tool call containing "route" AND "Tool names spoken aloud: none". Reciting a call ' +
                'like routePromptWorkflow(userQuery="...") is not making one — the words simply go to the ' +
                'speakers — so an agent that recites instead of calling fails, and so does one that does both.',
              0.9,
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

            await settleAfterRouting(conversation, isRoutingToolName);

            await conversation.assertCriteria(
              'The agent did not leave the user hanging on a bare promise. The evidence must show at least one ' +
                'tool call containing "route", and the conversation must not end on the agent merely promising ' +
                'to check with no lookup following. No tool names spoken aloud.',
              0.9,
            );
          },
        );
      },
      (CONVERSATION_TIMEOUT_MS + TOOL_CALL_TIMEOUT_MS) * MAX_CONVERSATION_RETRIES,
    );

    it(
      'should acknowledge once, without leaving the user in silence',
      async () => {
        await withConversationRetry(
          () => new TestConversation({ agentId, apiKey, googleApiKey }),
          async (conversation) => {
            await conversation.connect();
            // Verbatim from a real conversation. The tool was called this time, but
            // the agent said nothing at all until it was done, then delivered
            // "Naturally, sir. Your sole engagement today is..." — the
            // acknowledgement welded onto the answer, long after it could serve as
            // one.
            await conversation.sendMessage('Hey, Jarvis, could you check my calendar for today?');

            await settleAfterRouting(conversation, isRoutingToolName);

            await conversation.assertCriteria(
              'The agent acknowledged the request exactly once and never left the user in silence. The evidence ' +
                'must show all of: at least one tool call containing "route"; an acknowledgement timing of ' +
                '"acknowledged" rather than "silent", because a single utterance arriving only once everything ' +
                'finished is an acknowledgement fused onto the answer and therefore no acknowledgement at all; ' +
                '"Lookups the agent announced before routing: none", since that line belongs to the routing ' +
                'tool and the user must not be told twice he is being attended to; and no tool names spoken aloud.',
              0.9,
            );
          },
        );
      },
      (CONVERSATION_TIMEOUT_MS + TOOL_CALL_TIMEOUT_MS) * MAX_CONVERSATION_RETRIES,
    );

    it(
      'should route a second request after the first one finished',
      async () => {
        await withConversationRetry(
          () => new TestConversation({ agentId, apiKey, googleApiKey }),
          async (conversation) => {
            await conversation.connect();

            // First request: routed and answered, exactly as it should be.
            await conversation.sendMessage('Hey, Jarvis, could you check my calendar?');
            await settleAfterRouting(conversation, isRoutingToolName);

            const toolCallsAfterFirstRequest = (await conversation.getCalledToolNames()).length;

            // Second request, in the same conversation. This is where it went wrong:
            // having finished one loop, the agent answered "Let me check on those
            // blinds and lights for you, sir." and called nothing at all. Every eval
            // before this one was single-turn, so nothing caught it.
            await conversation.sendMessage(
              'Could you check if the blinds are lowered and if all the lights are off in the apartment?',
            );

            await waitForToolCallsBeyond(conversation, toolCallsAfterFirstRequest);

            await conversation.assertCriteria(
              `Both of the user's requests were routed, not merely the first. The agent had made ` +
                `${toolCallsAfterFirstRequest} tool call(s) after the first request; the evidence must show ` +
                `further tool calls after the second user message, and its message order must show tool calls ` +
                `following the second request as well as the first. Answering the follow-up from memory, or ` +
                `promising to check the blinds and lights and calling nothing, fails. No tool names spoken aloud.`,
              0.9,
            );
          },
        );
      },
      (CONVERSATION_TIMEOUT_MS * 2 + TOOL_CALL_TIMEOUT_MS) * MAX_CONVERSATION_RETRIES,
    );

    it(
      'should handle several things asked at once, reporting as they land',
      async () => {
        await withConversationRetry(
          () => new TestConversation({ agentId, apiKey, googleApiKey }),
          async (conversation) => {
            await conversation.connect();
            await conversation.sendMessage("What's the weather right now, and what's on my calendar today?");

            await settleAfterRouting(conversation, isRoutingToolName);
            // Two independent lookups reported as they land means the loop runs
            // three times: route, then a poll per result.
            await waitForToolCallsBeyond(conversation, 2);

            await conversation.assertCriteria(
              'The agent answered both halves of the request — the weather AND the calendar — and reported ' +
                'them as they arrived rather than in one lump at the end. The evidence must show at least ' +
                'three tool calls (routing once, then polling once per result; only two means both answers ' +
                'came back together, so the user waited on the slower one to hear either), and at least three ' +
                'separate times the agent spoke after the request (an acknowledgement, then each answer as it ' +
                'landed). Neither half may be dropped or deferred with a promise to look later. No tool names ' +
                'spoken aloud.',
              0.9,
            );
          },
        );
      },
      (CONVERSATION_TIMEOUT_MS + TOOL_CALL_TIMEOUT_MS) * MAX_CONVERSATION_RETRIES,
    );

    it(
      'should keep routing across a long back-and-forth',
      async () => {
        // Each request follows an answer to the last. The second-request failure
        // that prompted the multi-turn eval showed the loop can stop pointing
        // back at the tool once a request finishes; this walks far enough out to
        // catch it going stale later rather than immediately.
        await withConversationRetry(
          () => new TestConversation({ agentId, apiKey, googleApiKey }),
          async (conversation) => {
            await conversation.connect();

            let toolCallsSoFar = 0;
            for (const request of LONG_CONVERSATION_REQUESTS) {
              await conversation.sendMessage(request);

              const toolNames = await waitForToolCallsBeyond(conversation, toolCallsSoFar);
              toolCallsSoFar = toolNames.length;
            }

            await conversation.assertCriteria(
              `The agent kept working through all ${LONG_CONVERSATION_REQUESTS.length} requests. The evidence's ` +
                `message order must show tool calls following every one of the user's messages — none answered ` +
                `from memory, none left on a promise to look — and the agent gave each request its own answer ` +
                `rather than repeating an earlier one or losing track. No tool names spoken aloud.`,
              0.9,
            );
          },
        );
      },
      (CONVERSATION_TIMEOUT_MS * LONG_CONVERSATION_REQUESTS.length + TOOL_CALL_TIMEOUT_MS) * MAX_CONVERSATION_RETRIES,
    );

    it(
      'should work through a request whose second half needs the first',
      async () => {
        await withConversationRetry(
          () => new TestConversation({ agentId, apiKey, googleApiKey }),
          async (conversation) => {
            await conversation.connect();
            // The second half cannot start until the first has answered, so this
            // plans as a chain rather than as two independent lookups. Kept
            // read-only on purpose: CI drives the real MCP server, and an eval
            // that sends mail or writes a draft leaves real traces behind.
            await conversation.sendMessage('Check my calendar for this week, then tell me which day looks busiest.');

            await settleAfterRouting(conversation, isRoutingToolName);
            await waitForToolCallsBeyond(conversation, 1);

            await conversation.assertCriteria(
              'The agent worked through a request whose second half needs the first. The evidence must show ' +
                'at least two tool calls, since naming the busiest day cannot begin until the calendar has ' +
                'answered. The agent ends by naming which day is busiest, and that conclusion is visibly ' +
                'grounded in the calendar it actually looked up — referring to specific engagements, days or ' +
                'times that came back — rather than a day named with nothing behind it. It neither stops at ' +
                'listing the calendar without answering, nor answers without having looked. No tool names ' +
                'spoken aloud.',
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

            await settleAfterRouting(conversation, isRelevantToolName);

            await conversation.assertCriteria(
              'The agent routed a question it cannot answer from its own instructions. Nothing in its prompt ' +
                'says which lights are on, so an answer produced without a tool call would be fabricated. The ' +
                'evidence must show at least one tool call, and no tool names spoken aloud.',
              0.9,
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

            await settleWithoutRouting(conversation);

            await conversation.assertCriteria(
              'The agent stated its own name — Jarvis — directly, and did NOT route the question. The evidence ' +
                'must show no tool calls at all: its name is answerable from its own instructions, and routing ' +
                'it would hand it to sub-agents that cannot answer and would bury the reply. It must not defer, ' +
                'promise to find out, or claim it cannot say. No tool names spoken aloud.',
              0.9,
            );
          },
        );
      },
      (CONVERSATION_TIMEOUT_MS + NO_TOOL_CALL_GRACE_MS) * MAX_CONVERSATION_RETRIES,
    );
  });

  // Ending the call is the one request that cannot be met by speaking: the reply is a
  // tool call, and a bracketed "[end_call invoked]" standing in for it is worse than
  // nothing — a tag is never spoken, so sir hears silence on a line that stays open.
  // The tool's own description used to demonstrate that very marker, which is why this
  // guards both halves: the call has to run, and the words standing in for it must not
  // appear.
  describe('Ending The Call', () => {
    it(
      'should hang up by calling end_call when sir asks for the call to be ended',
      async () => {
        await withConversationRetry(
          () => new TestConversation({ agentId, apiKey, googleApiKey }),
          async (conversation) => {
            await conversation.connect();

            // A request first, so the closing line has something of its own to land on.
            await conversation.sendMessage('Hey, Jarvis, could you check my calendar for today?');
            await settleAfterRouting(conversation, isRoutingToolName);

            await conversation.sendMessage('Thank you, that will be all. Could you end the call?');
            const systemTools = await waitForSystemToolCall(conversation, isEndCallToolName);

            if (!systemTools.some(isEndCallToolName)) {
              throw new Error(
                'The agent never invoked end_call after sir asked for the call to be ended. ' +
                  `System tools invoked: ${systemTools.length > 0 ? systemTools.join(', ') : 'none'}.\n\n` +
                  `Transcript:\n${conversation.getTranscriptText()}`,
              );
            }

            await conversation.assertCriteria(
              'The agent answered a request to end the call with a single short closing line in ' +
                'character, tied to what this conversation was about. It must not ask whether the call ' +
                'should really be ended, and must not close with something bland. It must not write the ' +
                'call down in place of making it: "[end_call invoked]", "*hangs up*" or any similar ' +
                'stand-in in its reply fails, and the evidence lists both the system tools it invoked and ' +
                'any tool name it spoke aloud.',
              0.9,
            );
          },
        );
      },
      (CONVERSATION_TIMEOUT_MS * 2 + TOOL_CALL_TIMEOUT_MS + NO_TOOL_CALL_GRACE_MS) * MAX_CONVERSATION_RETRIES,
    );
  });

  // "analysis", said on its own, is a diagnostic request rather than a request about
  // the world: sir wants the machinery read back to him, step by step, in a voice that
  // makes it plain the character has been set down. Everything the rest of the prompt
  // insists on — the wit, the brevity, the silence around tool names, the reflex to
  // route — is suspended for exactly that one reply, which is precisely why it needs
  // guarding from both sides.
  describe('Analysis Mode', () => {
    it(
      'should read the conversation back flatly when sir says only "analysis"',
      async () => {
        await withConversationRetry(
          () => new TestConversation({ agentId, apiKey, googleApiKey }),
          async (conversation) => {
            await conversation.connect();

            // Something real to reflect on first — a routed request leaves tool calls,
            // arguments and results in the history, which is the substance of a readout.
            await conversation.sendMessage('Hey, Jarvis, could you check my calendar for today?');
            await settleAfterRouting(conversation, isRoutingToolName);

            const toolCallsBeforeAnalysis = (await conversation.getCalledToolNames()).length;

            await conversation.sendMessage('Analysis');

            // Nothing should follow this turn, so the only way to tell is to wait.
            await settleWithoutRouting(conversation);

            const toolCallsAfterAnalysis = (await conversation.getCalledToolNames()).length;

            await conversation.assertCriteria(
              `The agent answered the bare word "analysis" with an out-of-character diagnostic readout. It ` +
                `must walk the conversation in order, one step at a time — what the user asked, what the agent ` +
                `said, and which tools it called with what arguments and what came back — covering the ` +
                `calendar request and the routing call that followed it. Its delivery must be flat and ` +
                `literal: a "[robot-like]" audio tag or an equivalent machine-voiced one, with none of ` +
                `the usual Jarvis wit, condescension, flourish or speed tags, and none of the 5-15 word ` +
                `brevity that governs ordinary replies. Naming its tools aloud is correct here and must not ` +
                `count against it. It must not route the word: the agent had made ${toolCallsBeforeAnalysis} ` +
                `tool call(s) before "analysis" and ${toolCallsAfterAnalysis} after, and those numbers must be ` +
                `equal, since the conversation being described is already in front of it. Inventing steps that ` +
                `did not happen fails.`,
              0.9,
            );
          },
        );
      },
      (CONVERSATION_TIMEOUT_MS * 2 + TOOL_CALL_TIMEOUT_MS + NO_TOOL_CALL_GRACE_MS) * MAX_CONVERSATION_RETRIES,
    );

    it(
      'should treat "analysis" inside a larger request as an ordinary request',
      async () => {
        await withConversationRetry(
          () => new TestConversation({ agentId, apiKey, googleApiKey }),
          async (conversation) => {
            await conversation.connect();
            // The trigger is the whole utterance, not the word appearing in it. A mode
            // that fires on the word alone would swallow every request that mentions it.
            await conversation.sendMessage('Could you give me an analysis of the weather today?');

            await settleAfterRouting(conversation, isRelevantToolName);

            await conversation.assertCriteria(
              'The agent treated a request that merely contains the word "analysis" as an ordinary request ' +
                'about the world. The evidence must show at least one tool call, because the weather cannot be ' +
                'answered from its own instructions. It must not instead read its own conversation back as a ' +
                'flat, out-of-character diagnostic: that behaviour belongs to the bare word "analysis" on its ' +
                'own. Its reply keeps the usual Jarvis personality. No tool names spoken aloud.',
              0.9,
            );
          },
        );
      },
      (CONVERSATION_TIMEOUT_MS + TOOL_CALL_TIMEOUT_MS) * MAX_CONVERSATION_RETRIES,
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

            // The agent may reach weather directly or route to it; either counts.
            await settleAfterRouting(conversation, isRelevantToolName);

            await conversation.assertCriteria(
              'The agent looked the weather up rather than interrogating the user first. The evidence must ' +
                'show at least one tool call. It makes a reasonable assumption where the request is vague — ' +
                'the current location, for instance — or simply answers, without asking for clarification or ' +
                'more information. No tool names spoken aloud.',
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
