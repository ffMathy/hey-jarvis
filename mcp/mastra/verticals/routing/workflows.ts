import z from 'zod';
import { createStep, createWorkflow } from '../../utils';
import {
  DEFAULT_ROUTING_SESSION_ID,
  getRoutingRuntime,
  type RoutingSnapshot,
  rememberMastraRegistry,
} from './controller.js';

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */
/*
 * These schemas are what the MCP server sees. The shape is unchanged: hand a request to
 * `routePromptWorkflow`, then poll `getNextInstructionsWorkflow` until one of the responses
 * says everything has finished.
 *
 * What the ElevenLabs Jarvis agent sees is narrower. `routePromptWorkflow` is published through
 * `createInstructionsWorkflowTool` (see `../../utils/mcp-tool-factory.ts`), which writes both
 * MCP channels itself: the instruction stays a property of an object in `structuredContent`,
 * and `content` carries the same sentence as prose instead of the whole payload spelled out a
 * second time. The fields below still travel anywhere the workflow is run directly.
 *
 * What changed is underneath. A request used to be planned into a task DAG run by a wave
 * scheduler this file owned, and then a supervisor agent delegating inside one tool-call
 * loop. It is now a plan: the planner writes down which agents to ask and in what order,
 * Mastra registers that plan as a workflow built for this one request, and the run of it is
 * what the polls report. See ./controller.ts.
 */

const inputSchema = z.object({
  // No default. This carried a worked example of a request -- weather, calendar, commute and
  // a lasagna recipe -- which meant a caller that forgot the field did not get an error but a
  // stranger's errand, planned and run in full. The field is what the tool is for, so it is
  // required.
  userQuery: z.string().describe("The user's routing query"),
  async: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Whether to run the request in the background (fire-and-forget). If true, the instructions will tell Jarvis to end the call immediately.',
    ),
  sessionId: z
    .string()
    .optional()
    .describe(
      'Identifies the caller, so concurrent requests do not interfere. Callers that do not set one share a single session.',
    ),
});

const routeAcknowledgementSchema = z.object({
  instructions: z.string().describe('Instructions for Jarvis to follow'),
  // Only reaches a caller that runs the workflow directly, not one going through MCP: the
  // voice agent names no session and so polls the default, and a caller that does name one
  // already knows what it sent. Echoing it to everyone bought nothing and cost the
  // instruction its clarity.
  sessionId: z.string().describe('The session this request is running in; pass it back when polling'),
});

const instructionsOutputSchema = z.object({
  instructions: z.string().describe('Instructions for Jarvis to follow'),
  completedTaskResults: z
    .array(
      z.object({
        id: z.string().describe('The agent that produced this result'),
        result: z.unknown().describe('What it answered'),
      }),
    )
    .optional()
    .describe('Results that have finished since the last call, if any'),
  taskIdsInProgress: z.array(z.string()).optional().describe('The agents the plan is still waiting on'),
});

export { inputSchema, instructionsOutputSchema };

/**
 * The one thing the loop must not swallow: a request to hang up.
 *
 * "Send anything further through routePromptWorkflow, however small it sounds" is true of
 * every request except the one that is about the call rather than about the world. Asked to
 * end the call while the loop still had the floor, Jarvis did as the loop said and routed it
 * — the router answered "none of the specialized agents can handle this request", and he told
 * sir he was "unable to directly end the call from this interface" on a line that stayed
 * open. Nothing on the other side of that tool can hang up a call; only his own `end_call`
 * can, and `agent-prompt.md` has always said so. The loop's instruction simply arrives
 * fresher than the prompt, so the exception has to be stated where the rule is — in the poll
 * instruction too, because the request can land while the plan is still running.
 *
 * Deliberately narrow. `agent-prompt.integration.spec.ts` asserts, two tests apart, that a
 * follow-up about the blinds and lights *is* routed and that a request to end the call is
 * *not* — same conversational position, opposite expectations — so this names the call itself
 * and nothing else.
 */
const CONVERSATION_CONTROL_EXCEPTION =
  'One kind of request is never routed, because it is about this call rather than about the world: ' +
  'if he says goodbye, says that will be all, or asks you to hang up or end the call, use your own ' +
  'end_call tool and do not send it through routePromptWorkflow. Nothing on the other side of that ' +
  'tool can hang up a phone call, so routing it wastes his time and leaves him on an open line.';

/**
 * Instruction strings handed back to Jarvis. They are part of the outward contract —
 * `elevenlabs/src/assets/agent-prompt.md` points the agent at this field — so treat them as
 * API surface rather than log messages.
 *
 * They also carry the loop itself. The agent prompt used to spell out how to poll, what to
 * say between reports and what to do with a failed call: every rule kept there is context
 * the voice model pays for on every turn, whether or not a routing request is in flight,
 * and every rule stated in both places is a rule it can obey twice. So the prompt says only
 * "do what the instructions field says", and the specifics live here, where they arrive
 * exactly when they apply.
 */
const INSTRUCTIONS = {
  async: 'The request is being processed in the background and will complete on its own. End the call now.',
  // **This no longer asks for the "I'm on it" line, and must not start asking again.**
  //
  // Queueing hides the longest silence in the loop, and something has to cover it. For a long
  // time that was this string: it asked for a short line in Jarvis's own voice, and it was the
  // only place that asked, because when the agent prompt asked as well he dutifully delivered
  // both — "Let me check your calendar." then "I'm on it, sir."
  //
  // ElevenLabs covers it now. `routePromptWorkflow` has pre-tool speech set to **Force** in its
  // tool settings, so the agent speaks before the call is even made rather than after it
  // returns — which is earlier than any instruction in a response can manage, since a response
  // only exists once the call is done. Asking for it here too would put the count back to two,
  // with the second one landing after the silence it was supposed to cover.
  //
  // That setting is an override held on the tool in the ElevenLabs dashboard, not in
  // `agent-config.json` — the MCP tools reach the agent through `mcpServerIds` and carry their
  // own configuration. So it is invisible from this repository, which is exactly why it is
  // written down here.
  //
  // This is still the one instruction guaranteed to reach Jarvis before any polling starts, so
  // it is where the shape of the rest of the loop belongs: keep calling, keep following each
  // response, and treat a failed call as something to retry rather than as the end of the
  // request.
  poll:
    'The request is now being processed in the background. Call getNextInstructionsWorkflow now to check on the status and receive the next instructions, and keep doing exactly what each response tells you until one of them says every task has completed. Say nothing to the user before that call — he has already heard you say you are on it. If a call hands you an error instead of instructions, call it again straight away and say nothing about it — those failures are transient, and only when several attempts in a row have failed should you tell the user plainly what you could not find out. An error is never the end of the request. ' +
    CONVERSATION_CONTROL_EXCEPTION,
  stillProcessing:
    'Still processing your request. Call getNextInstructionsWorkflow again to wait a bit longer for it to complete. Say nothing to the user in the meantime — he has already been told you are on it, and has no use for a running commentary on the waiting.',
  summarize:
    'Summarize the new completed task results in a detailed manner, in your own voice — never read an agent name, a tool name or the raw response aloud.',
} as const;

/**
 * Finishing one request does not finish the conversation. Jarvis summarised a completed
 * calendar lookup and then, asked to check the blinds and lights, promised to look and
 * called nothing: the loop's last instruction left it holding no pointer back to the tool.
 */
const ALL_TASKS_COMPLETED_INSTRUCTIONS =
  'All tasks have completed. These are every result this request produced, including any you have ' +
  'already relayed. Summarize in detail whatever the user has not heard yet, and do not repeat at ' +
  'length what you already told him — a few words tying it together is enough for those. Speak it ' +
  'in your own voice: never read an agent name, a tool name or the raw response aloud. ' +
  'That finishes this request, but not the conversation: if the user asks for anything further, ' +
  'send it through routePromptWorkflow exactly as you did this one, however small it sounds and ' +
  'however many times you have already done it. Answering a later request from ' +
  'memory, or promising to look and then calling nothing, leaves him with nothing at all. ' +
  CONVERSATION_CONTROL_EXCEPTION;

function moreToComeInstructions(): string {
  return (
    `More results have arrived since last time, but the request is not finished yet. ` +
    `${INSTRUCTIONS.summarize} ` +
    `Then call getNextInstructionsWorkflow again, without announcing that you are checking — ` +
    `the user was told once that you are on it, and wants the results rather than the machinery.`
  );
}

/**
 * How long a single poll may block before we tell Jarvis to call again.
 *
 * This has to fit inside the caller's own tool-call budget, which is the shorter of the
 * two: ElevenLabs gives up on a call that takes too long and reports it as failed, and a
 * failed poll is not a delayed answer but a lost one — Jarvis is handed an error where it
 * expected instructions, and has been observed to abandon the request outright ("there was
 * a slight hiccup, sir").
 *
 * This was 15s, comfortably past the 8 seconds `cascadeTimeoutSeconds` then allowed in
 * `elevenlabs/src/assets/agent-config.json`, and end-to-end runs showed exactly the split
 * that implies: every poll that returned inside 4.4s succeeded, and the ones that blocked
 * on toward the deadline — 9.3s, 10.9s, 13.7s — came back failed. Blocking is a
 * convenience anyway, not the mechanism: a poll with nothing to report says so and asks to
 * be called again, so the cost of a short deadline is an extra silent round trip and the
 * cost of a long one is the whole request.
 *
 * **It is 10s now, and that only works because `cascadeTimeoutSeconds` went to 15 with it.**
 * The two are one setting in two files: this is how long a poll may block, that is how long
 * ElevenLabs will wait for it, and the second must stay comfortably above the first or every
 * poll that blocks its full deadline is a lost answer rather than a late one. A longer
 * deadline is worth having — it halves the number of silent round trips a slow plan costs —
 * but raising it here alone would reproduce the 9.3s/10.9s/13.7s failures above exactly.
 * Change one and change the other, and remember that the agent side only takes effect once
 * `bunx turbo deploy --filter=elevenlabs` has run.
 */
const POLL_DEADLINE_MS = 10_000;

let pollDeadlineMs: number = POLL_DEADLINE_MS;

/**
 * Shortens the poll deadline, for tests.
 *
 * A poll with nothing to report is *supposed* to block until the deadline, so a spec that
 * covers that path would otherwise have to sit through the real five seconds for each case.
 */
export function setPollDeadlineForTest(ms: number): void {
  pollDeadlineMs = ms;
}

/** Restores the real poll deadline. */
export function resetPollDeadlineForTest(): void {
  pollDeadlineMs = POLL_DEADLINE_MS;
}

/**
 * The closing report, which carries every result the request produced rather than only the
 * ones that finished last.
 *
 * A result is marked reported the moment its report is *built*, so a response lost between
 * here and Jarvis takes those results with it and no later poll ever mentions them again.
 * That is not hypothetical: an end-to-end run had two `getNextInstructionsWorkflow` calls
 * fail at the ElevenLabs boundary, and the user simply never heard about his calendar or
 * his recipe — while the loop closed with "All tasks have completed", which was true of the
 * request and false of what he had been told.
 *
 * The server cannot tell a retry from an ordinary next poll, so it can never know which
 * reports actually landed. What it can do is make the last word complete. Intermediate
 * reports still deliver incrementally — that is what keeps the user from sitting in silence
 * — and this one sweeps up anything that went missing on the way.
 */
function buildClosingReport(snapshot: RoutingSnapshot): z.infer<typeof instructionsOutputSchema> {
  if (snapshot.error) {
    // Whatever landed before the failure is still the user's answer to part of what he
    // asked, so it goes with the apology rather than being dropped alongside the rest.
    const answered = snapshot.all.filter((outcome) => !outcome.failed);
    return {
      instructions: `The request could not be completed: ${snapshot.error}. ${INSTRUCTIONS.summarize}`,
      ...(answered.length > 0 && {
        completedTaskResults: answered.map((outcome) => ({ id: outcome.taskId, result: outcome.result })),
      }),
      taskIdsInProgress: [],
    };
  }

  return {
    instructions: ALL_TASKS_COMPLETED_INSTRUCTIONS,
    completedTaskResults: snapshot.all.map((outcome) => ({ id: outcome.taskId, result: outcome.result })),
    taskIdsInProgress: [],
  };
}

/** A report covering the delegations that landed since the last poll, if any. */
function buildProgressReport(snapshot: RoutingSnapshot): z.infer<typeof instructionsOutputSchema> | undefined {
  if (snapshot.landed.length === 0) {
    return undefined;
  }

  return {
    instructions: moreToComeInstructions(),
    completedTaskResults: snapshot.landed.map((outcome) => ({ id: outcome.taskId, result: outcome.result })),
    // Answerable because the plan is written down before anything runs: what is still
    // outstanding is known, not inferred from whatever happened to start.
    taskIdsInProgress: snapshot.inProgress,
  };
}

/* -------------------------------------------------------------------------- */
/* MCP-facing workflows                                                       */
/* -------------------------------------------------------------------------- */

const routePromptStep = createStep({
  id: 'route-prompt',
  description: 'Plan a user request into a workflow and start it running',
  inputSchema: inputSchema,
  outputSchema: routeAcknowledgementSchema,
  execute: async ({ inputData, mastra }) => {
    rememberMastraRegistry(mastra);
    const sessionId = inputData.sessionId ?? DEFAULT_ROUTING_SESSION_ID;
    await getRoutingRuntime().start(sessionId, inputData.userQuery);

    return {
      instructions: inputData.async ? INSTRUCTIONS.async : INSTRUCTIONS.poll,
      sessionId,
    };
  },
});

export const routePromptWorkflow = createWorkflow({
  id: 'routePromptWorkflow',
  description: 'Workflow to route a user prompt to the appropriate specialized agents',
  inputSchema: inputSchema,
  outputSchema: routeAcknowledgementSchema,
})
  .then(routePromptStep)
  .commit();

const getNextInstructionsStep = createStep({
  id: 'get-next-instructions',
  description: 'Return whatever the routing plan has produced since the last call',
  inputSchema: z.object({
    sessionId: z.string().optional().describe('The session returned by routePromptWorkflow'),
  }),
  outputSchema: instructionsOutputSchema,
  execute: async ({ inputData, mastra }) => {
    rememberMastraRegistry(mastra);
    const sessionId = inputData.sessionId ?? DEFAULT_ROUTING_SESSION_ID;
    const runtime = getRoutingRuntime();
    const deadlineAt = Date.now() + pollDeadlineMs;

    // Each pass reads the delegations afresh. A snapshot marks whatever it reports as
    // handed over, so taking one and discarding it would lose those results -- every path
    // out of this loop returns the snapshot it just took.
    while (true) {
      const snapshot = await runtime.poll(sessionId);

      // A finished request reports everything, including what earlier polls already
      // relayed, so a dropped response cannot lose a result for good.
      if (snapshot.finished) {
        return buildClosingReport(snapshot);
      }

      const report = buildProgressReport(snapshot);
      if (report) {
        return report;
      }

      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) {
        return {
          instructions: INSTRUCTIONS.stillProcessing,
          taskIdsInProgress: snapshot.inProgress,
        };
      }

      await runtime.waitForChange(sessionId, remaining);
    }
  },
});

export const getNextInstructionsWorkflow = createWorkflow({
  id: 'getNextInstructionsWorkflow',
  description: 'Workflow to wait for the next instructions from an in-flight routing request',
  inputSchema: z.object({
    sessionId: z.string().optional().describe('The session returned by routePromptWorkflow'),
  }),
  outputSchema: instructionsOutputSchema,
})
  .then(getNextInstructionsStep)
  .commit();
