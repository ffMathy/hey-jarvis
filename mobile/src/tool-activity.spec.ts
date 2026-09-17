import { describe, expect, it } from 'bun:test';
import { NOTHING_IN_FLIGHT, toolCallFinished, toolCallStarted } from './tool-activity';

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

  it('leaves what it was given alone', () => {
    // These run inside a React state updater, where mutating the previous value is how a render
    // gets silently skipped.
    const before: readonly string[] = ['weather'];
    toolCallStarted(before, 'calendar');
    toolCallFinished(before, 'weather');

    expect(before).toEqual(['weather']);
  });
});
