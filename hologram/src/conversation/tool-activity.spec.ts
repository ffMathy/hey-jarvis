import { describe, expect, it } from 'bun:test';
import {
  KEEP_THINKING_AFTER_LAST_ANSWER_MS,
  NOTHING_IN_FLIGHT,
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
    // The window itself lives in a timer inside `useToolActivity`, which `bun test` has no
    // renderer for. This pins the number; what it does is covered by looking at the sphere.
    expect(KEEP_THINKING_AFTER_LAST_ANSWER_MS).toBe(2_000);
  });

  it('leaves what it was given alone', () => {
    // These run inside a React state updater, where mutating the previous value is how a render
    // gets silently skipped.
    const before: readonly string[] = ['weather'];
    toolCallStarted(before, 'calendar');
    toolCallFinished(before, 'weather');

    expect(before).toEqual(['weather']);
  });
});
