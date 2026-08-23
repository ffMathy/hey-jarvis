import { describe, expect, it } from 'bun:test';
import type { ServerMessage } from '../utils/conversation-strategy.js';
import {
  describeRoutingLoop,
  findRoutingLoopViolations,
  isFinalReport,
  parseRoutingReport,
  type RoutingReport,
  readRoutingLoop,
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
function called(toolName: string, payload?: unknown, state: 'success' | 'loading' = 'success'): ServerMessage {
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
