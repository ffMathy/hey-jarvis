import z from 'zod';
import { createStep, createWorkflow } from '../../utils';
import { DEFAULT_ROUTING_SESSION_ID, getRoutingRuntime, type RoutingProgress } from './controller.js';

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */
/*
 * These schemas are what the MCP server (and therefore the ElevenLabs Jarvis agent) sees.
 * The shape is unchanged: hand a request to `routePromptWorkflow`, then poll
 * `getNextInstructionsWorkflow` until one of the responses says everything has finished.
 * `elevenlabs/src/assets/agent-prompt.md` needs no change.
 *
 * What changed is underneath. A request used to be planned into a task DAG and executed by
 * a wave scheduler this file owned, with a module-global holding the one in-flight run. It
 * is now a supervisor agent delegating to the specialized agents inside an AgentController
 * Session — one session per caller, so a second request cannot displace the first.
 */

const inputSchema = z.object({
  userQuery: z
    .string()
    .describe("The user's routing query")
    .default(
      "I'd like to check the weather for my current location, and check my calendar for today. If I have any calendars regarding my workplace, I'd like to infer when I typically go to work, and check the traffic conditions for that time. Additionally, I am planning on making a lasagna, so please fetch the recipes for that and add a reminder to my to-do list with the ingredients, for when I get home from work.",
    ),
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
  taskIdsInProgress: z
    .array(z.string())
    .optional()
    .describe('Kept for the caller contract; the supervisor decides its own remaining work'),
});

export { inputSchema, instructionsOutputSchema };

/**
 * Instruction strings handed back to Jarvis. They are part of the outward contract —
 * `elevenlabs/src/assets/agent-prompt.md` points the agent at this field — so treat them as
 * API surface rather than log messages.
 *
 * They also carry the loop itself. The agent prompt used to spell out how to poll, what to
 * say between reports and what to do with a failed call, and the voice model running it is
 * a small one: every rule kept there is context it pays for on every turn, whether or not a
 * routing request is in flight, and every rule stated in both places is a rule it can obey
 * twice. So the prompt says only "do what the instructions field says", and the specifics
 * live here, where they arrive exactly when they apply.
 */
const INSTRUCTIONS = {
  async: 'The request is being processed in the background and will complete on its own. End the call now.',
  // Queueing hides the longest silence in the loop. This is the only place the "I'm on it"
  // line is specified. It was once asked for here *and* in the agent prompt, and Jarvis
  // duly delivered both — "Let me check your calendar." then "I'm on it, sir." — so the
  // prompt now stays out of it and this string is unconditional.
  //
  // This is also the one instruction guaranteed to reach Jarvis before any polling starts,
  // so it is where the shape of the rest of the loop belongs: keep calling, keep following
  // each response, and treat a failed call as something to retry rather than as the end of
  // the request.
  poll: 'The request is now being processed in the background. Say a short line in your own voice telling the user you are on it — under six words, spoken now, because he is otherwise left sitting in silence while this runs. This is the only such line he should hear, so give it here and nowhere else. Then call getNextInstructionsWorkflow to check on the status and receive the next instructions, and keep doing exactly what each response tells you until one of them says every task has completed. If a call hands you an error instead of instructions, call it again straight away and say nothing about it — those failures are transient, and only when several attempts in a row have failed should you tell the user plainly what you could not find out. An error is never the end of the request.',
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
  'memory, or promising to look and then calling nothing, leaves him with nothing at all.';

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
 * This was 15s, comfortably past the 8 seconds `cascadeTimeoutSeconds` allows in
 * `elevenlabs/src/assets/agent-config.json`, and end-to-end runs showed exactly the split
 * that implies: every poll that returned inside 4.4s succeeded, and the ones that blocked
 * on toward the deadline — 9.3s, 10.9s, 13.7s — came back failed. Blocking is a
 * convenience anyway, not the mechanism: a poll with nothing to report says so and asks to
 * be called again, so the cost of a short deadline is an extra silent round trip and the
 * cost of a long one is the whole request.
 */
const POLL_DEADLINE_MS = 5_000;

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
function buildClosingReport(progress: RoutingProgress): z.infer<typeof instructionsOutputSchema> {
  progress.pending = [];

  if (progress.error) {
    return {
      instructions: `The request could not be completed: ${progress.error}. ${INSTRUCTIONS.summarize}`,
      taskIdsInProgress: [],
    };
  }

  const results = progress.all.map((outcome) => ({ id: outcome.agentId, result: outcome.result }));

  // The supervisor's own closing text is the one thing that saw every result together, so
  // it leads. The individual results follow it for the recap.
  if (progress.summary) {
    results.unshift({ id: 'summary', result: progress.summary });
  }

  return {
    instructions: ALL_TASKS_COMPLETED_INSTRUCTIONS,
    completedTaskResults: results,
    taskIdsInProgress: [],
  };
}

/** A report covering the delegations that landed since the last poll, if any. */
function buildProgressReport(progress: RoutingProgress): z.infer<typeof instructionsOutputSchema> | undefined {
  if (progress.pending.length === 0) {
    return undefined;
  }

  const reporting = progress.pending;
  progress.pending = [];

  return {
    instructions: moreToComeInstructions(),
    completedTaskResults: reporting.map((outcome) => ({ id: outcome.agentId, result: outcome.result })),
    taskIdsInProgress: [],
  };
}

/** Resolves to `true` if the work landed before the deadline. */
async function withDeadline(work: Promise<void>, deadlineMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), deadlineMs);
  });

  try {
    return await Promise.race([work.then(() => true), timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* MCP-facing workflows                                                       */
/* -------------------------------------------------------------------------- */

const routePromptStep = createStep({
  id: 'route-prompt',
  description: 'Hand a user request to the routing supervisor and start it running',
  inputSchema: inputSchema,
  outputSchema: routeAcknowledgementSchema,
  execute: async ({ inputData }) => {
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
  description: 'Return whatever the routing supervisor has produced since the last call',
  inputSchema: z.object({
    sessionId: z.string().optional().describe('The session returned by routePromptWorkflow'),
  }),
  outputSchema: instructionsOutputSchema,
  execute: async ({ inputData }) => {
    const progress = await getRoutingRuntime().get(inputData.sessionId ?? DEFAULT_ROUTING_SESSION_ID);
    const deadlineAt = Date.now() + POLL_DEADLINE_MS;

    while (Date.now() < deadlineAt) {
      // A finished request reports everything, including what earlier polls already
      // relayed, so a dropped response cannot lose a result for good.
      if (progress.finished) {
        return buildClosingReport(progress);
      }

      const report = buildProgressReport(progress);
      if (report) {
        return report;
      }

      const landed = await withDeadline(progress.wait(), deadlineAt - Date.now());
      if (!landed) {
        break;
      }
    }

    if (progress.finished) {
      return buildClosingReport(progress);
    }

    const report = buildProgressReport(progress);
    return report ?? { instructions: INSTRUCTIONS.stillProcessing };
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
