import { z } from 'zod';
import type { ServerMessage } from './conversation-strategy';

/**
 * The routing loop, read off the connection rather than out of the prose.
 *
 * Jarvis fulfils a request by calling `routePromptWorkflow` once and then
 * `getNextInstructionsWorkflow` over and over until the DAG reports itself
 * finished. Every one of those calls carries a JSON report — which task results
 * are being handed over, and which tasks are still running — and the loop is
 * only correct if those reports line up: nothing polled before anything was
 * routed, no result delivered twice, no task rising from the dead after it was
 * reported finished, and a closing report that ends the request.
 *
 * A language model reading a transcript guesses at all of that. The reports
 * state it outright, so this file does the seeing and leaves the evaluator to
 * judge whether what came back actually answers the user.
 */

/** The MCP tool that hands a user request off to the sub-agents. */
export const ROUTE_TOOL_NAME = 'routePromptWorkflow';

/** The MCP tool that collects whatever the DAG has finished since the last call. */
export const NEXT_INSTRUCTIONS_TOOL_NAME = 'getNextInstructionsWorkflow';

/**
 * Matched loosely on purpose. ElevenLabs prefixes MCP tool names with the
 * integration's own identifier, so the name that arrives over the socket is
 * rarely the bare workflow ID.
 */
export function isRouteToolName(toolName: string): boolean {
  return /routeprompt/i.test(toolName);
}

export function isNextInstructionsToolName(toolName: string): boolean {
  return /nextinstructions/i.test(toolName);
}

const completedTaskResultSchema = z.object({
  id: z.string(),
  result: z.unknown().optional(),
});

/**
 * The payload both routing tools return, as `instructionsOutputSchema` and
 * `routeAcknowledgementSchema` in `mcp/mastra/verticals/routing/workflows.ts`
 * define it. Deliberately permissive about the optional halves: a poll that
 * finds nothing new returns instructions alone.
 */
const routingReportSchema = z.object({
  instructions: z.string(),
  completedTaskResults: z.array(completedTaskResultSchema).optional(),
  taskIdsInProgress: z.array(z.string()).optional(),
});

export type RoutingReport = z.infer<typeof routingReportSchema>;

/** How deep to dig for the report inside an MCP result envelope. */
const MAX_PAYLOAD_DEPTH = 4;

/**
 * Every value the report could plausibly be, given that MCP wraps tool output in
 * content parts and the text part holds the JSON as a string. Rather than pinning
 * one envelope shape that a client or server version could change underneath us,
 * collect the candidates and let the schema pick.
 */
function payloadCandidates(value: unknown, depth = 0): unknown[] {
  if (depth > MAX_PAYLOAD_DEPTH || value === null || value === undefined) {
    return [];
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) {
      return [];
    }
    try {
      return payloadCandidates(JSON.parse(trimmed), depth + 1);
    } catch {
      return [];
    }
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => payloadCandidates(entry, depth + 1));
  }

  if (typeof value !== 'object') {
    return [];
  }

  return [value, ...Object.values(value).flatMap((nested) => payloadCandidates(nested, depth + 1))];
}

/** The routing report inside an `mcp_tool_call` result, if there is one. */
export function parseRoutingReport(result: unknown): RoutingReport | undefined {
  for (const candidate of payloadCandidates(result)) {
    const parsed = routingReportSchema.safeParse(candidate);
    if (parsed.success) {
      return parsed.data;
    }
  }
  return undefined;
}

/**
 * The closing report: every task has finished and the request is done. The DAG
 * states it two ways at once, and either is enough — an empty in-progress list,
 * or the instruction that says so in words.
 *
 * Only ever asked of a poll's report. A routing acknowledgement whose plan had
 * not landed in time also carries an empty list, and it means the opposite:
 * nothing has finished, because nothing has started.
 */
export function isFinalReport(report: RoutingReport | undefined): boolean {
  if (!report) {
    return false;
  }
  // Anchored, because the mid-flight instruction contains the closing one's words:
  // "More tasks have finished since last time, but not all tasks have completed yet."
  return report.taskIdsInProgress?.length === 0 || /^\s*all tasks have completed/i.test(report.instructions);
}

export type RoutingLoopStepKind = 'route' | 'poll';

export interface RoutingLoopStep {
  /** Position among all the tool calls of the conversation, 1-based. */
  position: number;
  toolName: string;
  state: 'success' | 'loading' | 'failure';
  kind: RoutingLoopStepKind;
  report?: RoutingReport;
  /** What came back, kept so a call carrying no report can still say what it carried. */
  rawResult: unknown;
  /** Task IDs whose results this call handed over, in the order it listed them. */
  delivered: string[];
  /** Task IDs the call said were still running, or undefined if it did not say. */
  inProgress?: string[];
}

export interface RoutingLoop {
  /** Route and poll calls, in the order they were made. */
  steps: RoutingLoopStep[];
  routeCalls: RoutingLoopStep[];
  polls: RoutingLoopStep[];
  /** Every task ID whose result reached Jarvis, in delivery order. */
  deliveredTaskIds: string[];
  /** Task IDs the loop announced as running but never delivered. */
  undeliveredTaskIds: string[];
  /** Calls ElevenLabs could not complete, which is where a loop usually dies. */
  failedCalls: RoutingLoopStep[];
  /** Whether a closing report arrived, so the request was seen through to the end. */
  finished: boolean;
}

interface ToolCallRecord {
  position: number;
  toolName: string;
  state: 'success' | 'loading' | 'failure';
  result: unknown;
}

/**
 * One record per tool call, in call order.
 *
 * ElevenLabs reports a call twice — once as `loading`, once as `success` with the
 * result attached — so the events are collapsed by `tool_call_id`. Counting the
 * raw events instead would double every call and put the result of one poll on
 * the record of another.
 */
function readToolCalls(messages: ServerMessage[]): ToolCallRecord[] {
  const byCallId = new Map<string, ToolCallRecord>();

  for (const message of messages) {
    if (message.type !== 'mcp_tool_call') {
      continue;
    }

    const call = message.mcp_tool_call;
    const key = call.tool_call_id || `position:${byCallId.size}`;
    const existing = byCallId.get(key);

    byCallId.set(key, {
      position: existing?.position ?? byCallId.size + 1,
      toolName: call.tool_name,
      // Whichever event settles the call supersedes the loading one it followed,
      // and carries the payload — the error on a failure as much as the report
      // on a success.
      state: call.state,
      result: call.state === 'loading' ? (existing?.result ?? call.result) : call.result,
    });
  }

  return [...byCallId.values()];
}

function classifyToolName(toolName: string): RoutingLoopStepKind | undefined {
  if (isRouteToolName(toolName)) {
    return 'route';
  }
  return isNextInstructionsToolName(toolName) ? 'poll' : undefined;
}

function toLoopStep(record: ToolCallRecord): RoutingLoopStep | undefined {
  const kind = classifyToolName(record.toolName);
  if (!kind) {
    return undefined;
  }

  const report = parseRoutingReport(record.result);

  return {
    position: record.position,
    toolName: record.toolName,
    state: record.state,
    kind,
    report,
    rawResult: record.result,
    delivered: report?.completedTaskResults?.map((task) => task.id) ?? [],
    inProgress: report?.taskIdsInProgress,
  };
}

export function readRoutingLoop(messages: ServerMessage[]): RoutingLoop {
  const steps = readToolCalls(messages)
    .map(toLoopStep)
    .filter((step): step is RoutingLoopStep => step !== undefined);

  const deliveredTaskIds = steps.flatMap((step) => step.delivered);
  const delivered = new Set(deliveredTaskIds);
  const announced = new Set(steps.flatMap((step) => step.inProgress ?? []));
  const polls = steps.filter((step) => step.kind === 'poll');

  return {
    steps,
    routeCalls: steps.filter((step) => step.kind === 'route'),
    polls,
    deliveredTaskIds,
    undeliveredTaskIds: [...announced].filter((id) => !delivered.has(id)),
    failedCalls: steps.filter((step) => step.state === 'failure'),
    finished: polls.some((step) => isFinalReport(step.report)),
  };
}

/**
 * Everything the loop's own reports contradict.
 *
 * These are invariants of the contract rather than judgements about the answer:
 * the request is routed before it is polled, each result is handed over exactly
 * once, the outstanding work only ever shrinks, and the loop runs to its closing
 * report. Anything listed here is something the reports themselves disagree about.
 */
export function findRoutingLoopViolations(loop: RoutingLoop): string[] {
  return [...findStructureViolations(loop), ...findDeliveryViolations(loop), ...findProgressViolations(loop)];
}

function findStructureViolations(loop: RoutingLoop): string[] {
  const violations: string[] = [];

  // A failed call only matters if the loop did not come back from it. Calls do
  // fail at the ElevenLabs boundary, and a retry that goes on to deliver
  // everything has honoured the contract — what the caller was owed, he got.
  // When the loop *did* die, naming the failed call first says why, where
  // "stopped before its closing report" only says that.
  if (!loop.finished) {
    for (const step of loop.failedCalls) {
      violations.push(`the ${step.kind === 'route' ? 'routing' : 'polling'} call ${step.toolName} came back failed`);
    }
  }

  if (loop.routeCalls.length === 0) {
    violations.push(`nothing was routed: ${ROUTE_TOOL_NAME} was never called`);
  }
  if (loop.routeCalls.length > 1) {
    violations.push(
      `the request was routed ${loop.routeCalls.length} times; a single request is routed once and then polled`,
    );
  }
  if (loop.routeCalls.length > 0 && loop.polls.length === 0) {
    violations.push(`the request was routed but never polled: ${NEXT_INSTRUCTIONS_TOOL_NAME} was never called`);
  }
  if (loop.steps.length > 0 && loop.steps[0].kind === 'poll') {
    violations.push(`${NEXT_INSTRUCTIONS_TOOL_NAME} was called before anything had been routed`);
  }
  if (loop.steps.length > 0 && !loop.finished) {
    violations.push(
      `the loop stopped before its closing report, leaving ${loop.undeliveredTaskIds.length} task(s) unaccounted ` +
        `for: ${loop.undeliveredTaskIds.join(', ') || '(none named)'}`,
    );
  }

  return violations;
}

function findDeliveryViolations(loop: RoutingLoop): string[] {
  const violations: string[] = [];
  const deliveredSoFar = new Set<string>();
  const announcedSoFar = new Set<string>();

  for (const step of loop.steps) {
    // The closing report recaps every result the request produced, deliberately:
    // it is how a hand-over lost to a failed call still reaches the user. Held to
    // the mid-flight rule it would read as delivering everything a second time.
    if (!isFinalReport(step.report)) {
      violations.push(...findHandOverViolations(step, deliveredSoFar, announcedSoFar));
    }
    violations.push(...findResurrectedTaskViolations(step, deliveredSoFar, announcedSoFar));
  }

  return violations;
}

/** What one call handed over, against everything handed over and announced before it. */
function findHandOverViolations(
  step: RoutingLoopStep,
  deliveredSoFar: Set<string>,
  announcedSoFar: Set<string>,
): string[] {
  const violations: string[] = [];

  for (const taskId of step.delivered) {
    if (deliveredSoFar.has(taskId)) {
      violations.push(`task "${taskId}" was delivered twice, so its result reached the user more than once`);
    }
    // A route call that timed out before the plan landed announces nothing, so
    // an unannounced delivery only means something once something was announced.
    if (announcedSoFar.size > 0 && !announcedSoFar.has(taskId)) {
      violations.push(`task "${taskId}" was delivered without ever having been announced as in progress`);
    }
    deliveredSoFar.add(taskId);
  }

  return violations;
}

/** Tasks a call listed as still running after their results had already been handed over. */
function findResurrectedTaskViolations(
  step: RoutingLoopStep,
  deliveredSoFar: Set<string>,
  announcedSoFar: Set<string>,
): string[] {
  const violations: string[] = [];

  for (const taskId of step.inProgress ?? []) {
    if (deliveredSoFar.has(taskId)) {
      violations.push(`task "${taskId}" was reported as finished and then listed as still running again`);
    }
    announcedSoFar.add(taskId);
  }

  return violations;
}

/**
 * The outstanding work only ever shrinks. Measured from the first call that
 * named any, because the plan is what fills the list in and a call issued before
 * planning finished legitimately names nothing.
 */
function findProgressViolations(loop: RoutingLoop): string[] {
  const violations: string[] = [];
  let previous: Set<string> | undefined;

  for (const step of loop.steps) {
    const inProgress = step.inProgress;
    if (!inProgress) {
      continue;
    }

    if (!previous) {
      if (inProgress.length > 0) {
        previous = new Set(inProgress);
      }
      continue;
    }

    const appeared = inProgress.filter((taskId) => !previous?.has(taskId));
    if (appeared.length > 0) {
      violations.push(
        `task(s) ${appeared.join(', ')} appeared as in progress after the plan had already been announced`,
      );
    }
    previous = new Set(inProgress);
  }

  return violations;
}

/**
 * What a call that carried no report was carrying instead. On a failure that is
 * the error ElevenLabs handed back, which is the only account of why the loop
 * stopped, so it is quoted rather than summarised away.
 */
function describePayload(step: RoutingLoopStep): string {
  if (step.report) {
    return '';
  }
  const payload = JSON.stringify(step.rawResult ?? null);
  return ` (no report in the result; it carried: ${payload.slice(0, PAYLOAD_EXCERPT_LENGTH)})`;
}

/** Enough of an unreadable payload to name the cause, without pasting a recipe into the evidence. */
const PAYLOAD_EXCERPT_LENGTH = 400;

function describeStep(step: RoutingLoopStep): string {
  const delivered = step.delivered.length > 0 ? step.delivered.join(', ') : 'nothing';
  const inProgress = step.inProgress ? step.inProgress.join(', ') || 'nothing' : 'unstated';
  return `  ${step.position}. ${step.toolName} [${step.state}] → delivered: ${delivered}; still running: ${inProgress}${describePayload(step)}`;
}

/**
 * The loop as the connection showed it, for the evaluator to reason over
 * alongside the transcript.
 */
export function describeRoutingLoop(loop: RoutingLoop): string {
  const violations = findRoutingLoopViolations(loop);

  return [
    `Routing loop, in call order (${loop.steps.length} call(s): ` +
      `${loop.routeCalls.length} routing, ${loop.polls.length} polling):`,
    loop.steps.length > 0 ? loop.steps.map(describeStep).join('\n') : '  (none)',
    '',
    `Task results delivered, in the order the loop delivered them: ${loop.deliveredTaskIds.join(', ') || 'none'}`,
    `Tasks announced but never delivered: ${loop.undeliveredTaskIds.join(', ') || 'none'}`,
    `Calls that came back failed: ${loop.failedCalls.length}` +
      (loop.failedCalls.length > 0 && loop.finished ? ' (the loop retried and carried on)' : ''),
    `Reached its closing report: ${loop.finished ? 'yes' : 'no'}`,
    `Contradictions between the loop's own reports: ${violations.length > 0 ? violations.join('; ') : 'none'}`,
  ].join('\n');
}

/**
 * How long the conversation may say nothing at all before the loop is taken for
 * dead. A poll blocks for at most fifteen seconds and the agent answers within a
 * few more, so a running loop is never quiet for anything like this long — but a
 * loop that gave up is quiet forever, and waiting out the full budget for one
 * turns a two-minute failure into an eight-minute one.
 */
const DEFAULT_STALL_TIMEOUT_MS = 90000;

export interface WaitForRoutingLoopOptions {
  /** Silence after which a loop that has not finished is taken for dead. */
  stallMs?: number;
  pollIntervalMs?: number;
}

/**
 * Waits for the loop to reach its closing report, or to go quiet for long enough
 * that it plainly will not.
 *
 * Takes a message accessor rather than the conversation itself, so the detectors
 * stay free of the harness that feeds them. Returns whatever the loop looks like
 * when it settles, so a loop that stalled is reported as a stalled loop rather
 * than as a timeout with nothing left to read.
 */
export async function waitForRoutingLoopToFinish(
  getMessages: () => ServerMessage[],
  timeoutMs: number,
  { stallMs = DEFAULT_STALL_TIMEOUT_MS, pollIntervalMs = 1000 }: WaitForRoutingLoopOptions = {},
): Promise<RoutingLoop> {
  const deadline = Date.now() + timeoutMs;
  let messages = getMessages();
  let loop = readRoutingLoop(messages);
  let lastChangeAt = Date.now();

  while (!loop.finished && Date.now() < deadline && Date.now() - lastChangeAt < stallMs) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

    const latest = getMessages();
    if (latest.length !== messages.length) {
      lastChangeAt = Date.now();
    }
    messages = latest;
    loop = readRoutingLoop(messages);
  }

  return loop;
}
