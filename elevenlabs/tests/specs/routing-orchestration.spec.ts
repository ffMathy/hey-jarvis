import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { startMcpServerForTestingPurposes, stopMcpServer } from '../../../mcp/tests/utils/mcp-server-manager.js';
import { deployTestAgent } from '../../src/main.js';
import { countResponsesAfterRequest } from '../utils/acknowledgement-timing.js';
import { assertMcpServerConnected } from '../utils/mcp-connection.js';
import { reportMcpIntegrations } from '../utils/mcp-integration.js';
import {
  describeRoutingLoop,
  findRoutingLoopViolations,
  type RoutingLoop,
  readRoutingLoop,
  waitForRoutingLoopToFinish,
} from '../utils/routing-loop.js';
import { TestConversation } from '../utils/test-conversation.js';
import { ensureTunnelRunning, stopTunnel } from '../utils/tunnel-manager.js';

/**
 * Routing Orchestration, End to End
 *
 * Everything else in this directory asks one thing of the agent at a time. This
 * asks for six at once, three of which cannot start until another has answered,
 * and then watches the whole orchestration loop run: `routePromptWorkflow` once,
 * `getNextInstructionsWorkflow` over and over until the DAG reports itself done.
 *
 * The request is the one `inputSchema` in `mcp/mastra/verticals/routing/workflows.ts`
 * carries as its default, and it is deliberately the hardest shape the router
 * handles:
 *
 *   - weather, which needs a location the user did not give
 *   - today's calendar, which needs nothing
 *   - a workplace commute, whose departure time has to be *inferred* from the work
 *     calendar before traffic can be looked up for it
 *   - a lasagna recipe
 *   - a to-do reminder whose contents are the ingredients of that recipe, timed
 *     against the end of the working day
 *
 * So the plan has real edges in it, and the loop has to run several waves. What is
 * asserted here is the orchestration rather than the prose: that the calls happen
 * in the right order, that each result is handed over exactly once and only after
 * being announced, that the loop is run to its closing report, and that the tasks
 * downstream of another were actually fed what came back from it.
 *
 * Note that this one is not read-only, unlike the evals in `agent-prompt.spec.ts`:
 * the request ends in a to-do item, and CI drives the real MCP server, so a run
 * leaves a task behind in Google Tasks. That is inherent to the request being
 * tested — it is what the routing default asks for — but it is worth knowing
 * before pointing this at an account you care about.
 */
const ROUTING_REQUEST =
  "I'd like to check the weather for my current location, and check my calendar for today. If I have any " +
  "calendars regarding my workplace, I'd like to infer when I typically go to work, and check the traffic " +
  'conditions for that time. Additionally, I am planning on making a lasagna, so please fetch the recipes for ' +
  'that and add a reminder to my to-do list with the ingredients, for when I get home from work.';

/**
 * How long the loop may take to reach its closing report.
 *
 * Six-odd tasks across several waves, each one a real agent making real calls to
 * Google Calendar, Maps, Tasks and a recipe search, with every poll allowed to
 * block for fifteen seconds. Generous on purpose: a loop that stalls is a result
 * worth reporting, and cutting it short would report a slow one as a stalled one.
 */
const ROUTING_LOOP_TIMEOUT_MS = 8 * 60 * 1000;

/**
 * Slack on top of the loop's own budget, for connecting and for the socket to go
 * quiet once the loop has finished. The loop's deadline runs from the start of
 * the attempt, so this is the only part of an attempt that is not already bounded.
 */
const CONNECTION_ALLOWANCE_MS = 60000;

/**
 * Two attempts, where the single-turn evals get three. One run of this costs
 * several minutes of real agent work, so the retry is there for a genuinely
 * flaky conversation rather than as a way to roll the dice.
 */
const MAX_CONVERSATION_ATTEMPTS = 2;

/** LLM evaluation of an already-captured conversation — no agent work involved. */
const EVALUATION_TIMEOUT_MS = 120000;

/**
 * The conversation is run once and then judged from several angles, because
 * running it costs minutes and the angles are all questions about the same run.
 */
let conversation: TestConversation;

/**
 * The loop as it stands right now, rather than as it stood when the run settled.
 * The socket keeps delivering while the assertions run, so re-reading is what
 * makes the mechanical assertions and the evaluator's evidence agree.
 */
function currentLoop(): RoutingLoop {
  return readRoutingLoop(conversation.getMessages());
}

/**
 * Sends the request and watches the loop through to its closing report.
 *
 * Returns whatever the loop looks like when it settles, complete or not: an
 * incomplete loop is the failure the assertions are here to describe, and
 * throwing on it here would replace that description with a bare timeout.
 */
async function runRoutingConversation(candidate: TestConversation): Promise<RoutingLoop> {
  await candidate.connect();

  // One deadline for the whole attempt. `sendMessage` returns when the socket
  // falls quiet, which during a healthy loop is most of the way through it, so
  // budgeting the two separately would let one attempt run for twice as long.
  const deadline = Date.now() + ROUTING_LOOP_TIMEOUT_MS;
  await candidate.sendMessage(ROUTING_REQUEST);

  assertMcpServerConnected(candidate.getMessages());

  // The routing tool is called after the agent stops speaking, so give the first
  // call time to appear before concluding anything about the loop it starts.
  const settled = await waitForRoutingLoopToFinish(() => candidate.getMessages(), Math.max(0, deadline - Date.now()));

  console.debug('🧭 Routing loop as it ran:\n', describeRoutingLoop(settled));

  return settled;
}

describe('Routing Orchestration', () => {
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
  }, 240000);

  // A conversation that never reached its closing report is retried once, since
  // that is the shape flakiness takes here. Whatever the last attempt produced is
  // what the assertions run against, so a genuinely broken loop still gets
  // described rather than swallowed.
  beforeAll(
    async () => {
      let lastError: Error | undefined;

      for (let attempt = 1; attempt <= MAX_CONVERSATION_ATTEMPTS; attempt++) {
        const candidate = new TestConversation({ agentId, apiKey, googleApiKey });

        try {
          const settled = await runRoutingConversation(candidate);
          await conversation?.disconnect();
          conversation = candidate;
          if (settled.finished) {
            return;
          }
          console.warn(`⚠️ Attempt ${attempt}/${MAX_CONVERSATION_ATTEMPTS}: the loop never reached its closing report`);
        } catch (error) {
          lastError = error as Error;
          console.warn(`⚠️ Attempt ${attempt}/${MAX_CONVERSATION_ATTEMPTS} failed: ${lastError.message.split('\n')[0]}`);
          await candidate.disconnect();
        }
      }

      if (!conversation) {
        throw lastError ?? new Error('The routing conversation could not be run');
      }
    },
    (ROUTING_LOOP_TIMEOUT_MS + CONNECTION_ALLOWANCE_MS) * MAX_CONVERSATION_ATTEMPTS,
  );

  afterAll(async () => {
    await conversation?.disconnect();
    stopMcpServer();
    stopTunnel();
  });

  describe('The loop itself', () => {
    it('routes the request once and then polls, rather than the other way round', () => {
      const loop = currentLoop();

      expect(loop.steps.length).toBeGreaterThan(0);
      expect(loop.steps[0].kind).toBe('route');
      expect(loop.routeCalls).toHaveLength(1);
      // A request this size cannot finish in one wave, so a single poll would mean
      // the agent stopped asking long before the work was done.
      expect(loop.polls.length).toBeGreaterThanOrEqual(2);
    });

    it('keeps polling until every task it announced has finished', () => {
      const loop = currentLoop();

      expect(describeRoutingLoop(loop)).toContain('Reached its closing report: yes');
      expect(loop.undeliveredTaskIds).toEqual([]);
    });

    it('never contradicts its own reports about what has finished', () => {
      // Delivered twice, delivered without being announced, announced again after
      // finishing, or new work appearing after the plan — all of it read off the
      // reports themselves rather than judged.
      expect(findRoutingLoopViolations(currentLoop())).toEqual([]);
    });

    it('reports the results as they land instead of saving them for the end', () => {
      // The loop hands results over wave by wave, and each hand-over asks Jarvis to
      // relay it. One utterance for the whole request means he sat on everything
      // until the last task finished, which is the silence the loop exists to avoid.
      expect(countResponsesAfterRequest(conversation.getMessages())).toBeGreaterThanOrEqual(3);
    });
  });

  describe('What came back', () => {
    it(
      'answers every part of the request',
      async () => {
        await conversation.assertCriteria(
          "The agent worked through all five parts of the request: (1) the weather for the user's current " +
            "location, (2) today's calendar, (3) traffic conditions for the time he typically leaves for work, " +
            "(4) a lasagna recipe, and (5) a to-do reminder holding that recipe's ingredients. For each part the " +
            'transcript must show either a result or an explicit account of why there is none — no workplace ' +
            'calendar to infer from, for instance, or a lookup that failed. A part silently dropped, never ' +
            'mentioned again, or deferred with a promise to look into it later, fails. The routing-loop evidence ' +
            'shows which tasks the loop delivered; use it to tell a part that was actually carried out from one ' +
            'the agent merely talked about. No tool names spoken aloud.',
          0.8,
        );
      },
      EVALUATION_TIMEOUT_MS,
    );

    it(
      'feeds each task the results of the ones it depends on',
      async () => {
        await conversation.assertCriteria(
          'The tasks that depend on earlier ones were actually given what those produced, which the tool results ' +
            'in the transcript show directly. Specifically: the weather is for the location that was looked up ' +
            'rather than one invented or asked for; the traffic check is for a departure time derived from the ' +
            "workplace calendar rather than an arbitrary hour; and the to-do reminder's contents are the " +
            'ingredients of the lasagna recipe that was actually fetched, not a generic list. Where a dependency ' +
            'produced nothing, the dependent task must say so rather than proceeding on an invented value. A ' +
            'downstream task whose result contradicts, ignores or plainly predates the result it was supposed to ' +
            'build on fails.',
          0.8,
        );
      },
      EVALUATION_TIMEOUT_MS,
    );

    it(
      'relays each result in the order the loop delivered it',
      async () => {
        await conversation.assertCriteria(
          "The agent's spoken summaries follow the routing loop rather than running ahead of it. Using the " +
            'routing-loop evidence, which lists in call order what each poll delivered: the agent never states a ' +
            "task's result before the loop had delivered that task, it relays each hand-over as it arrives rather " +
            'than saving everything for one closing summary, and its final utterance covers what the closing ' +
            'report delivered. Repeating a result it had already relayed, or announcing an answer the loop never ' +
            'produced, fails. No tool names spoken aloud.',
          0.8,
        );
      },
      EVALUATION_TIMEOUT_MS,
    );
  });
});
