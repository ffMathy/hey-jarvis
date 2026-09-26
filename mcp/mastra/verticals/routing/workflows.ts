import z from 'zod';
import { createStep, createWorkflow } from '../../utils';
import {
  DEFAULT_ROUTING_SESSION_ID,
  getRoutingRuntime,
  type RoutingSnapshot,
  rememberMastraRegistry,
} from './controller.js';
import type { ResponseStyle } from './planner.js';

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
  // **Everything the user asked for, in one call.** A request naming two things went out as two
  // calls, one after the other: the calendar was planned, run, polled and reported, and only then
  // did the email start — so the second answer arrived a whole round later than it needed to, and
  // the caller heard the request treated as two errands rather than one. Nothing downstream wanted
  // that. The planner reads this string and writes a task per part, with the independent ones
  // running side by side (see `plannerInstructions`), so splitting it here throws that away and
  // buys nothing. The description is where this has to be said, because it is what the voice model
  // reads when it decides what to put in the field.
  userQuery: z
    .string()
    .describe(
      'Everything the user asked for in this turn, in one call. If they asked for two things — their calendar and their email, say — both belong in this one string: the plan splits the work itself and runs the independent parts at the same time, so a request sent in pieces is answered in pieces and later.',
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
      'Leave this out. Only a caller running several requests side by side needs one, to keep them apart, and it must then pass the same value to getNextInstructionsWorkflow. Callers that do not set one share a single session.',
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
  questionsForUser: z
    .array(
      z.object({
        id: z.string().describe('The task that asked'),
        question: z.string().describe('What to ask the user'),
      }),
    )
    .optional()
    .describe('Questions only the user can answer, which part of the request is waiting on'),
  slowTaskIds: z
    .array(z.string())
    .optional()
    .describe('Tasks that have just started work taking minutes rather than seconds'),
});

const pollInputSchema = z.object({
  sessionId: z
    .string()
    .optional()
    .describe(
      'Leave this out unless you passed a sessionId to routePromptWorkflow, and then pass that same value. Never make one up.',
    ),
  notifyWhenDone: z
    .boolean()
    .optional()
    .describe(
      'Set to true only when the user has accepted your offer to notify him when slow work is done. Leave it out otherwise.',
    ),
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
} as const;

/**
 * How to speak a result, by the style the planner gave the request (see `RESPONSE_STYLES`).
 *
 * This used to be one sentence for every request -- "summarize the new completed task results in
 * a detailed manner" -- so "turn off the lights" was explicitly asked for detail, and Jarvis
 * obliged with a paragraph and a quip about a room he could not see. Only a briefing wants detail.
 * A command wants a confirmation, and its words are worth spending only where the result differs
 * from what was asked; a lookup wants its one fact; conversation is where the wit belongs.
 */
const SPEAKING_INSTRUCTIONS: Record<ResponseStyle, string> = {
  command:
    'Confirm what was done in a few words, in your own voice — "Done, sir." is enough. Add no remark unless ' +
    'something went differently than he asked — a device not found, a value you had to choose for him, a part ' +
    'that failed — and then say exactly what differed; that is where a dry remark may go. If he cannot see the ' +
    'result himself — an alarm, a list, a message sent — name the one detail that proves it, such as the time or ' +
    'the item.',
  lookup: 'Give him the answer in one short sentence, with at most one dry remark.',
  briefing: 'Summarize the results in detail, in a natural spoken order, with at most one dry remark.',
  conversation: 'Answer in your full character — the wit is welcome here — but keep it to what you would say out loud.',
};

function speakingInstructions(style: ResponseStyle): string {
  return `${SPEAKING_INSTRUCTIONS[style]} Never read an agent name, a tool name or the raw response aloud.`;
}

/**
 * The client tool that ends the call a few seconds after Jarvis finishes, unless sir speaks.
 *
 * Declared on the agent in `elevenlabs/src/assets/agent-config.json` and handled by every client
 * that can hear sir -- the phone and watch apps through `hologram/conversation`, the Voice speaker
 * in its firmware. Its name has to match in all of those places.
 *
 * A finished request is where a call most often dies of politeness: Jarvis has answered, sir has
 * what he came for, and the line stays open until a thirty-second silence timeout gives up on it.
 * The client, not the model, keeps the clock, because only the client knows when Jarvis has
 * actually stopped talking and whether sir has said anything since.
 */
export const HANG_UP_WHEN_QUIET_TOOL = 'hangUpWhenQuiet';

/**
 * What ends every finished request: the silent hand-off to the hang-up, and the one fallback for a
 * call with no client to keep the clock.
 *
 * A telephone call has no app on the other end, so nothing handles the client tool there. What it
 * has instead is the agent's turn timeout, which asks Jarvis to speak again after a short silence
 * -- and at that point, with nothing new from sir, the right thing to say is nothing, and to hang up.
 */
const HANG_UP_WHEN_QUIET_INSTRUCTIONS =
  `Once you have said it, call ${HANG_UP_WHEN_QUIET_TOOL}, silently and without announcing it. It does not ` +
  'hang up by itself: the call ends only if he then stays quiet for a few seconds, so it never cuts him off, and ' +
  'anything he says first keeps the line open. If you are asked to speak again before he has said anything, he ' +
  'has nothing more: call end_call without a word. ';

/**
 * The recap is for results that never reached Jarvis, not for results he already spoke. "Do not
 * repeat at length — a few words tying it together is enough" was read by gpt-5.6-luna as leave
 * to restate the weather, figures and all, and the lasagna reminder a second time, which is the
 * repetition the routing-orchestration eval fails. So the instruction now forbids it outright.
 *
 * Finishing one request does not finish the conversation. Jarvis summarised a completed
 * calendar lookup and then, asked to check the blinds and lights, promised to look and
 * called nothing: the loop's last instruction left it holding no pointer back to the tool.
 */
function recapInstructions(style: ResponseStyle): string {
  return (
    'These are every result this request produced, including any you have already relayed. Tell him ' +
    'whatever he has not heard yet, and say nothing again that you already told him during this request: ' +
    'no figure, list or detail a second time, and no recap of it at the end. The earlier results are only ' +
    'here in case one of them never reached you; if you have already spoken about it, leave it out. ' +
    `${speakingInstructions(style)} `
  );
}

function allTasksCompletedInstructions(style: ResponseStyle): string {
  return (
    `All tasks have completed. ${recapInstructions(style)}` +
    HANG_UP_WHEN_QUIET_INSTRUCTIONS +
    'That finishes this request, but not the conversation: if the user asks for anything further, ' +
    'send it through routePromptWorkflow exactly as you did this one, however small it sounds and ' +
    'however many times you have already done it. Answering a later request from ' +
    'memory, or promising to look and then calling nothing, leaves him with nothing at all. ' +
    'Anything further means something he says next, not a part of what he already asked that you ' +
    'left out of this request — if he asked for two things, both should have gone out together, and ' +
    'routing the second one now is a round trip he should never have had to wait through. ' +
    CONVERSATION_CONTROL_EXCEPTION
  );
}

/**
 * The closing instruction when part of the request stopped to ask sir something.
 *
 * Three things have to survive the trip into a voice model that is otherwise told never to ask
 * him anything. That this question is to be asked anyway, because it is not Jarvis's own
 * uncertainty but the work's. That it is asked and then left alone -- answered neither by
 * Jarvis nor by a guess. And that the answer goes back the way everything else he says does,
 * through `routePromptWorkflow`: the planner is shown the questions still open, and recognises
 * the reply as an answer to one of them (see `verticals/routing/questions.ts`).
 *
 * The question comes last so that his answer is the next thing he says.
 */
function askTheUserInstructions(hasResults: boolean, style: ResponseStyle): string {
  return (
    'Part of this request cannot go on until the user answers a question, which is in questionsForUser. ' +
    (hasResults ? `Everything else has finished. ${recapInstructions(style)}Then ` : '') +
    'Ask him the question — briefly, in your own voice, as the last thing you say — and stop there to let him answer. ' +
    'It is not a clarifying question of yours: the work is waiting on it and only he can answer it, so ask it even ' +
    'though you otherwise never ask him anything, and never answer it for him or guess what he would say. ' +
    'If there is more than one, ask them together, saying what each is about. ' +
    'When he answers, send his answer through routePromptWorkflow in his own words, exactly as you would any other ' +
    'request: that is what carries it back to the work that asked. If he asks for something else instead, route that ' +
    'as usual, and the question stays open. ' +
    CONVERSATION_CONTROL_EXCEPTION
  );
}

function moreToComeInstructions(style: ResponseStyle): string {
  return (
    `More results have arrived since last time, but the request is not finished yet. ` +
    `${speakingInstructions(style)} ` +
    `Then call getNextInstructionsWorkflow again, without announcing that you are checking — ` +
    `the user was told once that you are on it, and wants the results rather than the machinery.`
  );
}

/**
 * The offer made when part of a request has started something slow.
 *
 * Slow means minutes (see `utils/slow-tasks.ts`), and a voice call is a bad place to spend them:
 * sir sits through silence, or hangs up and never hears the result. So Jarvis offers to notify
 * him instead, once per slow task.
 *
 * His reply is the dangerous part. Everything else he says goes through `routePromptWorkflow`,
 * and a new request there supersedes this one -- which would cancel the very work he just agreed
 * to be told about. So the reply to the offer is answered with `notifyWhenDone` on the next poll,
 * never routed, and this says so where the rule to route everything is otherwise given.
 */
function slowTaskOfferInstructions(hasResults: boolean, style: ResponseStyle): string {
  return (
    (hasResults ? `More results have arrived since last time. ${speakingInstructions(style)} Then: ` : '') +
    'Slow work has started: the tasks in slowTaskIds will take several minutes, and the request is not finished. ' +
    'Tell the user so in one short sentence, in your own voice, and offer to notify him when it is done so that he ' +
    'need not stay on the line. Then stop and let him answer. ' +
    'If he accepts, call getNextInstructionsWorkflow with notifyWhenDone set to true. If he declines or would rather ' +
    'wait, call getNextInstructionsWorkflow as before. Either way, his reply to this offer is not a new request: never ' +
    'send it through routePromptWorkflow, because a new request there cancels this one. ' +
    CONVERSATION_CONTROL_EXCEPTION
  );
}

/**
 * The reply to accepting the offer. The request now carries on without the call, so Jarvis is
 * released from polling it, and anything further sir asks for can be routed without cancelling it.
 */
function notifyWhenDoneInstructions(hasResults: boolean, style: ResponseStyle): string {
  return (
    (hasResults ? `More results have arrived since last time. ${speakingInstructions(style)} Then: ` : '') +
    'The user will be notified when this request is done — with its results, or with any question it needs him to ' +
    'answer. Tell him so in a few words. It carries on in the background whatever else he asks for, so stop calling ' +
    'getNextInstructionsWorkflow for it. ' +
    HANG_UP_WHEN_QUIET_INSTRUCTIONS +
    'If he asks for anything further, send it through routePromptWorkflow as usual. ' +
    CONVERSATION_CONTROL_EXCEPTION
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
      instructions:
        `The request could not be completed: ${snapshot.error}. Tell him plainly, in a sentence, what could not be ` +
        `done, then anything that did finish: ${speakingInstructions(snapshot.responseStyle)} ` +
        HANG_UP_WHEN_QUIET_INSTRUCTIONS +
        CONVERSATION_CONTROL_EXCEPTION,
      ...(answered.length > 0 && {
        completedTaskResults: answered.map((outcome) => ({ id: outcome.taskId, result: outcome.result })),
      }),
      taskIdsInProgress: [],
    };
  }

  const completedTaskResults = snapshot.all.map((outcome) => ({ id: outcome.taskId, result: outcome.result }));

  if (snapshot.questions.length > 0) {
    return {
      instructions: askTheUserInstructions(completedTaskResults.length > 0, snapshot.responseStyle),
      ...(completedTaskResults.length > 0 && { completedTaskResults }),
      taskIdsInProgress: [],
      questionsForUser: snapshot.questions.map((question) => ({ id: question.taskId, question: question.question })),
    };
  }

  return {
    instructions: allTasksCompletedInstructions(snapshot.responseStyle),
    completedTaskResults,
    taskIdsInProgress: [],
  };
}

/**
 * A report covering the delegations that landed since the last poll, and any that have just
 * started something slow, if there is either.
 */
function buildProgressReport(snapshot: RoutingSnapshot): z.infer<typeof instructionsOutputSchema> | undefined {
  const hasResults = snapshot.landed.length > 0;
  const hasNewlySlow = snapshot.newlySlow.length > 0;
  if (!hasResults && !hasNewlySlow) {
    return undefined;
  }

  return {
    instructions: hasNewlySlow
      ? slowTaskOfferInstructions(hasResults, snapshot.responseStyle)
      : moreToComeInstructions(snapshot.responseStyle),
    ...(hasResults && {
      completedTaskResults: snapshot.landed.map((outcome) => ({ id: outcome.taskId, result: outcome.result })),
    }),
    // Answerable because the plan is written down before anything runs: what is still
    // outstanding is known, not inferred from whatever happened to start.
    taskIdsInProgress: snapshot.inProgress,
    ...(hasNewlySlow && { slowTaskIds: snapshot.newlySlow }),
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
  inputSchema: pollInputSchema,
  outputSchema: instructionsOutputSchema,
  execute: async ({ inputData, mastra }) => {
    rememberMastraRegistry(mastra);
    const sessionId = inputData.sessionId ?? DEFAULT_ROUTING_SESSION_ID;
    const runtime = getRoutingRuntime();
    const deadlineAt = Date.now() + pollDeadlineMs;

    // Accepting the offer is answered at once rather than after a wait: sir has just said yes,
    // and the reply to that is Jarvis saying he will be told. A request that finished in the
    // meantime has nothing to notify about, and is reported by the loop below like any other.
    if (inputData.notifyWhenDone && (await runtime.notifyWhenDone(sessionId))) {
      const snapshot = await runtime.poll(sessionId);
      if (!snapshot.finished) {
        return {
          instructions: notifyWhenDoneInstructions(snapshot.landed.length > 0, snapshot.responseStyle),
          ...(snapshot.landed.length > 0 && {
            completedTaskResults: snapshot.landed.map((outcome) => ({ id: outcome.taskId, result: outcome.result })),
          }),
          taskIdsInProgress: snapshot.inProgress,
        };
      }

      return buildClosingReport(snapshot);
    }

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
  inputSchema: pollInputSchema,
  outputSchema: instructionsOutputSchema,
})
  .then(getNextInstructionsStep)
  .commit();
