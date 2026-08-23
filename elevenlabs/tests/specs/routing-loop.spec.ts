import { describe, expect, it } from 'bun:test';
import type { ServerMessage } from '../utils/conversation-strategy.js';
import {
  describeRoutingLoop,
  findRoutingLoopViolations,
  isFinalReport,
  parseRoutingReport,
  type RoutingReport,
  readRoutingLoop,
  waitForRoutingLoopToFinish,
} from '../utils/routing-loop.js';

/**
 * The live orchestration eval needs credentials, a tunnel and several minutes of
 * real agent work; this needs none of it. It pins down what the detector behind
 * that eval treats as a well-formed routing loop, so a change in that judgement
 * fails here — cheaply, on every push — rather than quietly widening or narrowing
 * what the eval is able to catch.
 */

let nextCallId = 0;

/** An MCP tool call as ElevenLabs reports it: the payload arrives as a text part. */
function called(
  toolName: string,
  payload?: unknown,
  state: 'success' | 'loading' | 'failure' = 'success',
): ServerMessage {
  nextCallId += 1;
  return {
    type: 'mcp_tool_call',
    mcp_tool_call: {
      tool_name: toolName,
      tool_call_id: `call-${nextCallId}`,
      state,
      result: payload === undefined ? [] : [{ type: 'text', text: JSON.stringify(payload) }],
    },
  } as unknown as ServerMessage;
}

const routed = (...taskIds: string[]): ServerMessage =>
  called('routePromptWorkflow', {
    instructions: 'The request is now being processed in the background.',
    taskIdsInProgress: taskIds,
  });

const polled = (delivered: string[], stillRunning: string[]): ServerMessage =>
  called('getNextInstructionsWorkflow', {
    instructions:
      stillRunning.length === 0
        ? 'All tasks have completed. Summarize the new completed task results in a detailed manner.'
        : 'More tasks have finished since last time, but not all tasks have completed yet.',
    completedTaskResults: delivered.map((id) => ({ id, result: `Result of ${id}` })),
    taskIdsInProgress: stillRunning,
  });

/**
 * The full happy path, shaped like the DAG the lasagna request actually plans:
 * one route call naming the whole graph, then a poll per wave as the tasks land,
 * ending on the closing report.
 */
const healthyLoop = (): ServerMessage[] => [
  { type: 'user_message', text: 'Weather, calendar, traffic, lasagna, and a reminder please.' } as ServerMessage,
  routed(
    'user-location',
    'calendar-today',
    'work-calendar',
    'lasagna-recipe',
    'weather-lookup',
    'traffic-check',
    'todo-reminder',
  ),
  polled(
    ['calendar-today'],
    ['user-location', 'work-calendar', 'lasagna-recipe', 'weather-lookup', 'traffic-check', 'todo-reminder'],
  ),
  polled(['user-location', 'lasagna-recipe'], ['work-calendar', 'weather-lookup', 'traffic-check', 'todo-reminder']),
  polled(['work-calendar', 'weather-lookup'], ['traffic-check', 'todo-reminder']),
  polled(['traffic-check', 'todo-reminder'], []),
];

describe('parseRoutingReport', () => {
  const report = {
    instructions: 'Call again.',
    completedTaskResults: [{ id: 'a', result: 'x' }],
    taskIdsInProgress: ['b'],
  };

  it('reads the report out of an MCP text content part', () => {
    expect(parseRoutingReport([{ type: 'text', text: JSON.stringify(report) }])).toEqual(report as RoutingReport);
  });

  it('reads a report handed over as a plain object', () => {
    expect(parseRoutingReport([report])).toEqual(report as RoutingReport);
  });

  it('reads a report nested inside a content envelope', () => {
    expect(parseRoutingReport({ content: [{ type: 'text', text: JSON.stringify(report) }] })).toEqual(
      report as RoutingReport,
    );
  });

  it('reads a poll that found nothing new, which carries instructions alone', () => {
    const stillProcessing = { instructions: 'Still processing your request.' };
    expect(parseRoutingReport([{ type: 'text', text: JSON.stringify(stillProcessing) }])).toEqual(stillProcessing);
  });

  it('returns nothing for a result that holds no report', () => {
    expect(parseRoutingReport([{ type: 'text', text: 'The weather in Aarhus is 15°C.' }])).toBeUndefined();
    expect(parseRoutingReport([])).toBeUndefined();
    expect(parseRoutingReport(undefined)).toBeUndefined();
  });
});

describe('isFinalReport', () => {
  it('recognises the closing report by its empty in-progress list', () => {
    expect(isFinalReport({ instructions: 'Anything at all.', taskIdsInProgress: [] })).toBe(true);
  });

  it('recognises the closing report by its wording', () => {
    expect(isFinalReport({ instructions: 'All tasks have completed. Summarize the results.' })).toBe(true);
  });

  it('does not mistake a mid-flight report for the closing one', () => {
    // Verbatim from the workflow, and the reason the wording is matched anchored:
    // the mid-flight instruction contains the closing one's words inside a negation.
    expect(
      isFinalReport({
        instructions:
          'More tasks have finished since last time, but not all tasks have completed yet. ' +
          'Then call getNextInstructionsWorkflow again.',
        taskIdsInProgress: ['b'],
      }),
    ).toBe(false);
    expect(isFinalReport({ instructions: 'More tasks have finished.', taskIdsInProgress: ['b'] })).toBe(false);
    expect(isFinalReport({ instructions: 'Still processing your request.' })).toBe(false);
    expect(isFinalReport(undefined)).toBe(false);
  });
});

describe('readRoutingLoop', () => {
  it('reads the calls in order, with what each one delivered', () => {
    const loop = readRoutingLoop(healthyLoop());

    expect(loop.routeCalls).toHaveLength(1);
    expect(loop.polls).toHaveLength(4);
    expect(loop.steps.map((step) => step.kind)).toEqual(['route', 'poll', 'poll', 'poll', 'poll']);
    expect(loop.deliveredTaskIds).toEqual([
      'calendar-today',
      'user-location',
      'lasagna-recipe',
      'work-calendar',
      'weather-lookup',
      'traffic-check',
      'todo-reminder',
    ]);
    expect(loop.undeliveredTaskIds).toEqual([]);
    expect(loop.finished).toBe(true);
  });

  it('counts a call once, not once per event, when the loading event is followed by the result', () => {
    // ElevenLabs reports the same call twice. Counting the events instead of the
    // calls would double every poll and hang each result on the wrong one.
    const loadingThenSuccess: ServerMessage[] = [
      {
        type: 'mcp_tool_call',
        mcp_tool_call: { tool_name: 'routePromptWorkflow', tool_call_id: 'call-x', state: 'loading', result: [] },
      } as unknown as ServerMessage,
      {
        type: 'mcp_tool_call',
        mcp_tool_call: {
          tool_name: 'routePromptWorkflow',
          tool_call_id: 'call-x',
          state: 'success',
          result: [{ type: 'text', text: JSON.stringify({ instructions: 'Poll now.', taskIdsInProgress: ['a'] }) }],
        },
      } as unknown as ServerMessage,
    ];

    const loop = readRoutingLoop(loadingThenSuccess);

    expect(loop.steps).toHaveLength(1);
    expect(loop.steps[0].state).toBe('success');
    expect(loop.steps[0].inProgress).toEqual(['a']);
  });

  it('matches the tool names ElevenLabs actually reports, prefix and all', () => {
    const loop = readRoutingLoop([
      called('jarvis_mcp_server_routePromptWorkflow', { instructions: 'Poll now.', taskIdsInProgress: ['a'] }),
      called('jarvis_mcp_server_getNextInstructionsWorkflow', {
        instructions: 'All tasks have completed.',
        completedTaskResults: [{ id: 'a', result: 'done' }],
        taskIdsInProgress: [],
      }),
    ]);

    expect(loop.routeCalls).toHaveLength(1);
    expect(loop.polls).toHaveLength(1);
    expect(loop.finished).toBe(true);
  });

  it('ignores tool calls that are not part of the loop', () => {
    const loop = readRoutingLoop([called('transfer_to_agent', { instructions: 'not a routing report' })]);
    expect(loop.steps).toHaveLength(0);
  });
});

describe('findRoutingLoopViolations', () => {
  it('passes a loop whose reports agree with each other', () => {
    expect(findRoutingLoopViolations(readRoutingLoop(healthyLoop()))).toEqual([]);
  });

  it('catches polling before anything was routed', () => {
    const violations = findRoutingLoopViolations(readRoutingLoop([polled([], ['a']), polled(['a'], [])]));
    expect(violations.join('\n')).toContain('before anything had been routed');
  });

  it('catches a request that was never routed at all', () => {
    const violations = findRoutingLoopViolations(readRoutingLoop([]));
    expect(violations.join('\n')).toContain('nothing was routed');
  });

  it('catches a request that was routed but never polled', () => {
    const violations = findRoutingLoopViolations(readRoutingLoop([routed('a', 'b')]));
    expect(violations.join('\n')).toContain('never polled');
  });

  it('catches the same result being delivered twice', () => {
    const violations = findRoutingLoopViolations(
      readRoutingLoop([routed('a', 'b'), polled(['a'], ['b']), polled(['a', 'b'], [])]),
    );
    expect(violations.join('\n')).toContain('"a" was delivered twice');
  });

  it('catches a finished task being listed as running again', () => {
    const violations = findRoutingLoopViolations(
      readRoutingLoop([routed('a', 'b'), polled(['a'], ['b']), polled(['b'], ['a'])]),
    );
    expect(violations.join('\n')).toContain('listed as still running again');
  });

  it('catches work appearing after the plan was announced', () => {
    const violations = findRoutingLoopViolations(
      readRoutingLoop([routed('a', 'b'), polled(['a'], ['b', 'c']), polled(['b', 'c'], [])]),
    );
    expect(violations.join('\n')).toContain('appeared as in progress after the plan');
  });

  it('catches the loop stopping before its closing report', () => {
    const violations = findRoutingLoopViolations(readRoutingLoop([routed('a', 'b'), polled(['a'], ['b'])]));
    expect(violations.join('\n')).toContain('stopped before its closing report');
    expect(violations.join('\n')).toContain('b');
  });

  it('forgives an empty plan on the route call, which only means planning had not landed', () => {
    // routePromptWorkflow answers on a deadline. When planning outruns it, the
    // acknowledgement names no tasks — the poll that follows names them all, and
    // that is the contract working, not a task appearing from nowhere.
    const violations = findRoutingLoopViolations(readRoutingLoop([routed(), polled(['a'], ['b']), polled(['b'], [])]));
    expect(violations).toEqual([]);
  });
});

describe('describeRoutingLoop', () => {
  it('lays out the loop for the evaluator, call by call', () => {
    const description = describeRoutingLoop(readRoutingLoop(healthyLoop()));

    expect(description).toContain('1 routing, 4 polling');
    expect(description).toContain('delivered: calendar-today');
    expect(description).toContain('Reached its closing report: yes');
    expect(description).toContain("Contradictions between the loop's own reports: none");
  });

  it('names the contradictions it found', () => {
    const description = describeRoutingLoop(readRoutingLoop([routed('a', 'b'), polled(['a'], ['b'])]));
    expect(description).toContain('Reached its closing report: no');
    expect(description).toContain('stopped before its closing report');
  });
});

/**
 * The failure mode the first live run actually produced: a poll comes back
 * `failure`, the agent says "there was a slight hiccup" and never calls again.
 * The loop is dead at that point, and the evidence has to say so in those terms
 * rather than leaving "stopped before its closing report" to stand for it.
 */
describe('a call that came back failed', () => {
  const withFailedPoll = (): ServerMessage[] => [
    routed('a', 'b', 'c'),
    polled(['a'], ['b', 'c']),
    called('getNextInstructionsWorkflow', { error: 'tool call failed' }, 'failure'),
  ];

  it('names the failed call rather than only its consequence', () => {
    const violations = findRoutingLoopViolations(readRoutingLoop(withFailedPoll()));

    expect(violations.join('\n')).toContain('getNextInstructionsWorkflow came back failed');
    expect(violations[0]).toContain('came back failed');
  });

  it('collects the failed calls so a test can point at them', () => {
    const loop = readRoutingLoop(withFailedPoll());

    expect(loop.failedCalls).toHaveLength(1);
    expect(loop.failedCalls[0].state).toBe('failure');
    expect(loop.finished).toBe(false);
  });

  it('quotes what the failed call carried, since that is the only account of why', () => {
    const description = describeRoutingLoop(readRoutingLoop(withFailedPoll()));

    expect(description).toContain('[failure]');
    expect(description).toContain('tool call failed');
  });

  it('keeps the settled result rather than the loading event it followed', () => {
    // The failure event carries the error; the loading event before it carried
    // nothing. Preferring the earlier one would throw away the reason.
    const loop = readRoutingLoop([
      {
        type: 'mcp_tool_call',
        mcp_tool_call: { tool_name: 'routePromptWorkflow', tool_call_id: 'call-y', state: 'loading', result: [] },
      } as unknown as ServerMessage,
      {
        type: 'mcp_tool_call',
        mcp_tool_call: {
          tool_name: 'routePromptWorkflow',
          tool_call_id: 'call-y',
          state: 'failure',
          result: [{ type: 'text', text: 'upstream refused the payload' }],
        },
      } as unknown as ServerMessage,
    ]);

    expect(loop.steps).toHaveLength(1);
    expect(loop.steps[0].state).toBe('failure');
    expect(describeRoutingLoop(loop)).toContain('upstream refused the payload');
  });
});

describe('waitForRoutingLoopToFinish', () => {
  it('returns as soon as the closing report has landed', async () => {
    const loop = await waitForRoutingLoopToFinish(healthyLoop, 5000, { stallMs: 5000, pollIntervalMs: 5 });
    expect(loop.finished).toBe(true);
  });

  it('gives up on a loop that has gone quiet, rather than waiting out the budget', async () => {
    // A dead loop is silent forever. Waiting the full budget for one turned a
    // two-minute failure into an eight-minute one, twice, on the first live run.
    const messages = [routed('a', 'b'), polled(['a'], ['b'])];
    const startedAt = Date.now();

    const loop = await waitForRoutingLoopToFinish(() => messages, 60000, { stallMs: 60, pollIntervalMs: 5 });

    expect(loop.finished).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });

  it('keeps waiting while the conversation is still moving', async () => {
    const messages: ServerMessage[] = [routed('a', 'b')];
    const timer = setInterval(() => {
      if (messages.length === 1) messages.push(polled(['a'], ['b']));
      else if (messages.length === 2) messages.push(polled(['b'], []));
    }, 20);

    try {
      const loop = await waitForRoutingLoopToFinish(() => messages, 5000, { stallMs: 200, pollIntervalMs: 5 });
      expect(loop.finished).toBe(true);
    } finally {
      clearInterval(timer);
    }
  });
});
