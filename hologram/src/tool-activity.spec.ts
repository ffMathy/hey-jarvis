import { describe, expect, it } from 'bun:test';
import {
  createToolActivity,
  KEEP_THINKING_AFTER_LAST_ANSWER_MS,
  NOTHING_IN_FLIGHT,
  type ToolActivity,
  toolCallFinished,
  toolCallStarted,
} from './tool-activity';

/**
 * Which of Jarvis's tool calls are running, which is what the hologram's thinking state is drawn
 * from. See `tool-activity.ts` for why it is a list of ids rather than a flag.
 */
describe('keeping track of the tool calls Jarvis has in flight', () => {
  it('starts with nothing running', () => {
    expect(NOTHING_IN_FLIGHT).toHaveLength(0);
  });

  it('is thinking from the first call until the last answer', () => {
    // Two at once is the case a flag gets wrong: an agent asking the weather and the calendar in
    // one turn is one thought, and the first answer back must not end it.
    let running = toolCallStarted(NOTHING_IN_FLIGHT, 'weather');
    running = toolCallStarted(running, 'calendar');
    expect(running).toHaveLength(2);

    running = toolCallFinished(running, 'weather');
    expect(running).toEqual(['calendar']);

    running = toolCallFinished(running, 'calendar');
    expect(running).toHaveLength(0);
  });

  it('counts one call once, however many times it is announced', () => {
    const running = toolCallStarted(toolCallStarted(NOTHING_IN_FLIGHT, 'weather'), 'weather');

    expect(running).toEqual(['weather']);
    expect(toolCallFinished(running, 'weather')).toHaveLength(0);
  });

  it('ignores an answer to a call it never saw begin', () => {
    // Which happens: a screen can join a conversation already under way, and an event can be lost.
    // Anything other than ignoring it risks a sphere stuck mid-thought, which is worse than a
    // thought never shown.
    expect(toolCallFinished(NOTHING_IN_FLIGHT, 'never-asked')).toHaveLength(0);
    expect(toolCallFinished(['weather'], 'never-asked')).toEqual(['weather']);
  });

  it('holds the thought open longer than the gap between two polls', () => {
    // A routing request is a stream of tool calls, not one: `getNextInstructionsWorkflow` is
    // called again and again while the plan runs, and the sphere dropped out of thinking and
    // back into it on every round. The window has to outlast the gap between one poll returning
    // and the next going out — which is the voice model reading a response and deciding, well
    // under a second — while still being short enough that one quick lookup visibly ends.
    //
    // What the window does is pinned below, against `createToolActivity`, which the session every
    // device runs keeps; this pins the number.
    expect(KEEP_THINKING_AFTER_LAST_ANSWER_MS).toBe(2_000);
  });

  it('leaves what it was given alone', () => {
    // A list that changed in place would look unchanged to whoever compares it with the last one,
    // and the settling window would never start.
    const before: readonly string[] = ['weather'];
    toolCallStarted(before, 'calendar');
    toolCallFinished(before, 'weather');

    expect(before).toEqual(['weather']);
  });
});

/**
 * A clock the test moves by hand, so the settling window is stepped through rather than waited out.
 * Timers fire in the order they are due, and a cleared one never fires.
 */
function createManualClock() {
  let now = 0;
  let nextTimer = 1;
  const pending = new Map<number, { due: number; callback: () => void }>();

  const earliest = () => [...pending.entries()].sort(([, one], [, other]) => one.due - other.due)[0];

  return {
    setTimeout: (callback: () => void, milliseconds: number) => {
      const timer = nextTimer++;
      pending.set(timer, { due: now + milliseconds, callback });
      return timer;
    },
    clearTimeout: (timer: number) => {
      pending.delete(timer);
    },
    advance: (milliseconds: number) => {
      const until = now + milliseconds;
      let next = earliest();
      while (next && next[1].due <= until) {
        const [timer, { due, callback }] = next;
        pending.delete(timer);
        now = due;
        callback();
        next = earliest();
      }
      now = until;
    },
    pendingTimers: () => pending.size,
  };
}

/** A tool activity on a manual clock, and everything it has told its listener. */
function followedActivity(): {
  activity: ToolActivity;
  clock: ReturnType<typeof createManualClock>;
  heard: boolean[];
} {
  const clock = createManualClock();
  const heard: boolean[] = [];
  const activity = createToolActivity({
    onChange: (thinking) => heard.push(thinking),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  return { activity, clock, heard };
}

/**
 * The thinking state with no React underneath, as the session every device runs keeps it, on the
 * clock it is handed.
 */
describe('createToolActivity', () => {
  it('is not thinking until a call begins, and says nothing until then', () => {
    const { activity, heard } = followedActivity();

    expect(activity.thinking()).toBe(false);
    expect(heard).toEqual([]);
  });

  it('thinks from the first call until the window after the last answer has passed', () => {
    const { activity, clock, heard } = followedActivity();

    activity.toolHandlers.onAgentToolRequest({ tool_call_id: 'weather' });
    expect(activity.thinking()).toBe(true);

    activity.toolHandlers.onAgentToolResponse({ tool_call_id: 'weather' });
    // Still thinking: the answer starts the window rather than ending the thought.
    expect(activity.thinking()).toBe(true);

    clock.advance(KEEP_THINKING_AFTER_LAST_ANSWER_MS - 1);
    expect(activity.thinking()).toBe(true);

    clock.advance(1);
    expect(activity.thinking()).toBe(false);
    expect(heard).toEqual([true, false]);
  });

  it('does not end a thought while another call of the same turn is still in flight', () => {
    const { activity, clock } = followedActivity();

    activity.toolHandlers.onAgentToolRequest({ tool_call_id: 'weather' });
    activity.toolHandlers.onAgentToolRequest({ tool_call_id: 'calendar' });
    activity.toolHandlers.onAgentToolResponse({ tool_call_id: 'weather' });
    clock.advance(KEEP_THINKING_AFTER_LAST_ANSWER_MS * 3);

    expect(activity.thinking()).toBe(true);
    expect(clock.pendingTimers()).toBe(0);
  });

  it('carries a thought through a call that arrives inside the window, timed from the new answer', () => {
    // A routing request's polls: each answer is followed, well inside the window, by the next call.
    const { activity, clock, heard } = followedActivity();

    activity.toolHandlers.onAgentToolRequest({ tool_call_id: 'route' });
    activity.toolHandlers.onAgentToolResponse({ tool_call_id: 'route' });
    clock.advance(KEEP_THINKING_AFTER_LAST_ANSWER_MS / 2);
    activity.toolHandlers.onAgentToolRequest({ tool_call_id: 'poll' });
    // The first window went with the new call, so it cannot end the thought that continued.
    expect(clock.pendingTimers()).toBe(0);
    clock.advance(KEEP_THINKING_AFTER_LAST_ANSWER_MS * 2);
    activity.toolHandlers.onAgentToolResponse({ tool_call_id: 'poll' });

    clock.advance(KEEP_THINKING_AFTER_LAST_ANSWER_MS - 1);
    expect(activity.thinking()).toBe(true);
    clock.advance(1);
    expect(activity.thinking()).toBe(false);
    // One thought, told once in and once out, never flickering between the polls.
    expect(heard).toEqual([true, false]);
  });

  it("follows an MCP call's state: thinking while it is loading, and not once it is anything else", () => {
    const { activity, clock } = followedActivity();

    activity.toolHandlers.onMCPToolCall({ tool_call_id: 'lights', state: 'loading' });
    expect(activity.thinking()).toBe(true);

    // Waiting on the user's approval is Jarvis idle, not Jarvis working.
    activity.toolHandlers.onMCPToolCall({ tool_call_id: 'lights', state: 'awaiting_approval' });
    clock.advance(KEEP_THINKING_AFTER_LAST_ANSWER_MS);
    expect(activity.thinking()).toBe(false);
  });

  it('counts one call once, however many times it is announced', () => {
    const { activity, clock, heard } = followedActivity();

    activity.toolHandlers.onAgentToolRequest({ tool_call_id: 'weather' });
    activity.toolHandlers.onMCPToolCall({ tool_call_id: 'weather', state: 'loading' });
    activity.toolHandlers.onAgentToolResponse({ tool_call_id: 'weather' });
    clock.advance(KEEP_THINKING_AFTER_LAST_ANSWER_MS);

    expect(activity.thinking()).toBe(false);
    expect(heard).toEqual([true, false]);
  });

  it('ignores an answer to a call it never saw begin, leaving a running window alone', () => {
    const { activity, clock, heard } = followedActivity();

    activity.toolHandlers.onAgentToolResponse({ tool_call_id: 'never-asked' });
    expect(activity.thinking()).toBe(false);
    expect(clock.pendingTimers()).toBe(0);

    activity.toolHandlers.onAgentToolRequest({ tool_call_id: 'weather' });
    activity.toolHandlers.onAgentToolResponse({ tool_call_id: 'weather' });
    clock.advance(KEEP_THINKING_AFTER_LAST_ANSWER_MS / 2);
    // Neither restarts nor ends the window it arrives in.
    activity.toolHandlers.onAgentToolResponse({ tool_call_id: 'never-asked' });
    expect(activity.thinking()).toBe(true);
    clock.advance(KEEP_THINKING_AFTER_LAST_ANSWER_MS / 2);

    expect(activity.thinking()).toBe(false);
    expect(heard).toEqual([true, false]);
  });

  it('forgets at once when the conversation ends, with nothing left to fire afterwards', () => {
    const { activity, clock, heard } = followedActivity();

    activity.toolHandlers.onAgentToolRequest({ tool_call_id: 'weather' });
    activity.toolHandlers.onAgentToolRequest({ tool_call_id: 'calendar' });
    activity.toolHandlers.onAgentToolResponse({ tool_call_id: 'weather' });
    activity.forget();

    expect(activity.thinking()).toBe(false);
    expect(heard).toEqual([true, false]);

    // A call that was running when the session dropped is gone too: its late answer changes nothing.
    activity.toolHandlers.onAgentToolResponse({ tool_call_id: 'calendar' });
    expect(clock.pendingTimers()).toBe(0);
    expect(heard).toEqual([true, false]);
  });

  it('forgets the settling window too, rather than holding him in a thought after the call has ended', () => {
    const { activity, clock, heard } = followedActivity();

    activity.toolHandlers.onAgentToolRequest({ tool_call_id: 'weather' });
    activity.toolHandlers.onAgentToolResponse({ tool_call_id: 'weather' });
    expect(clock.pendingTimers()).toBe(1);

    activity.forget();

    expect(activity.thinking()).toBe(false);
    expect(clock.pendingTimers()).toBe(0);
    clock.advance(KEEP_THINKING_AFTER_LAST_ANSWER_MS);
    expect(heard).toEqual([true, false]);
  });

  it('starts the next conversation from nothing after forgetting', () => {
    const { activity, clock, heard } = followedActivity();

    activity.toolHandlers.onAgentToolRequest({ tool_call_id: 'weather' });
    activity.forget();
    activity.toolHandlers.onAgentToolRequest({ tool_call_id: 'weather' });
    activity.toolHandlers.onAgentToolResponse({ tool_call_id: 'weather' });
    clock.advance(KEEP_THINKING_AFTER_LAST_ANSWER_MS);

    expect(heard).toEqual([true, false, true, false]);
  });
});
