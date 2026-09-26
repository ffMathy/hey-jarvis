import { describe, expect, it } from 'bun:test';
import {
  afterQuietEvent,
  HANG_UP_WHEN_QUIET_TOOL,
  hangUpDueAt,
  isTimeToHangUp,
  NOT_WATCHING,
  QUIET_BEFORE_HANGING_UP_MS,
  type QuietEvent,
  type QuietWatch,
  USER_SPEECH_THRESHOLD,
} from './quiet-hang-up';

/** The hang-up after each of `events` in turn, from wherever it starts. */
function after(events: readonly QuietEvent[], from: QuietWatch = NOT_WATCHING): QuietWatch {
  return events.reduce(afterQuietEvent, from);
}

/** Armed at `at`, with Jarvis already quiet: what a `post_tool_speech` call usually finds. */
const ARMED_AT_ZERO = after([{ type: 'hangUpRequested', at: 0 }]);

/**
 * The contract with the agent, which calls the tool by name and is configured by someone else. A
 * spelling or a window changed here and not there is a hang-up that never happens.
 */
describe('the contract with the agent', () => {
  it('is the tool the agent calls, and the window the user is given', () => {
    expect(HANG_UP_WHEN_QUIET_TOOL).toBe('hangUpWhenQuiet');
    expect(QUIET_BEFORE_HANGING_UP_MS).toBe(3_000);
  });

  it("calls it off at the firmware's announcement threshold, stricter than the lattice's", () => {
    expect(USER_SPEECH_THRESHOLD).toBe(0.5);
  });
});

describe('hanging up after a finished request is followed by quiet', () => {
  it('hangs up once it has been quiet for the whole window after the call', () => {
    expect(hangUpDueAt(ARMED_AT_ZERO)).toBe(QUIET_BEFORE_HANGING_UP_MS);
    expect(isTimeToHangUp(ARMED_AT_ZERO, QUIET_BEFORE_HANGING_UP_MS - 1)).toBe(false);
    expect(isTimeToHangUp(ARMED_AT_ZERO, QUIET_BEFORE_HANGING_UP_MS)).toBe(true);
  });

  it('never hangs up when no request asked it to', () => {
    // Every conversation that has not finished a request yet — and one whose agent has not been
    // redeployed with the tool — must never be ended by a clock.
    const watch = after([
      { type: 'jarvisSpeaking', speaking: true, at: 0 },
      { type: 'jarvisSpeaking', speaking: false, at: 1_000 },
    ]);

    expect(hangUpDueAt(watch)).toBeUndefined();
    expect(isTimeToHangUp(watch, 1_000_000)).toBe(false);
  });

  it('starts the quiet over when a second request finishes while armed', () => {
    const watch = after([{ type: 'hangUpRequested', at: 2_000 }], ARMED_AT_ZERO);

    expect(hangUpDueAt(watch)).toBe(2_000 + QUIET_BEFORE_HANGING_UP_MS);
  });
});

/** The clock is his silence, not the wall's. */
describe('waiting while Jarvis speaks', () => {
  it('does not start the clock while he is still speaking when the call arrives', () => {
    // `post_tool_speech` sends the call once he has finished, but the SDK's own idea of whether he
    // is speaking can trail the audio. The clock waits for it.
    const watch = after([
      { type: 'jarvisSpeaking', speaking: true, at: 0 },
      { type: 'hangUpRequested', at: 500 },
    ]);
    expect(hangUpDueAt(watch)).toBeUndefined();

    const quiet = after([{ type: 'jarvisSpeaking', speaking: false, at: 900 }], watch);
    expect(hangUpDueAt(quiet)).toBe(900 + QUIET_BEFORE_HANGING_UP_MS);
  });

  it('puts the clock back to nothing when he speaks again, and stays armed', () => {
    const watch = after(
      [
        { type: 'jarvisSpeaking', speaking: true, at: 2_500 },
        { type: 'jarvisSpeaking', speaking: false, at: 4_000 },
      ],
      ARMED_AT_ZERO,
    );

    // Two and a half seconds of quiet before he spoke again count for nothing.
    expect(isTimeToHangUp(watch, QUIET_BEFORE_HANGING_UP_MS)).toBe(false);
    expect(hangUpDueAt(watch)).toBe(4_000 + QUIET_BEFORE_HANGING_UP_MS);
    expect(watch.armed).toBe(true);
  });

  it('has no clock at all for as long as he goes on speaking', () => {
    const watch = after([{ type: 'jarvisSpeaking', speaking: true, at: 1_000 }], ARMED_AT_ZERO);

    expect(hangUpDueAt(watch)).toBeUndefined();
    expect(isTimeToHangUp(watch, 1_000_000)).toBe(false);
  });

  it('ignores a repeat of what it already knows', () => {
    // A mode reported twice must not restart a clock that is already running.
    const watch = after([{ type: 'jarvisSpeaking', speaking: false, at: 2_000 }], ARMED_AT_ZERO);

    expect(watch).toBe(ARMED_AT_ZERO);
  });
});

describe('the user answering', () => {
  it('calls it off for good when they are heard', () => {
    const watch = after(
      [
        { type: 'vadScore', score: 0.8 },
        // And nothing that follows brings it back: only another finished request does.
        { type: 'jarvisSpeaking', speaking: true, at: 1_000 },
        { type: 'jarvisSpeaking', speaking: false, at: 2_000 },
      ],
      ARMED_AT_ZERO,
    );

    expect(watch.armed).toBe(false);
    expect(hangUpDueAt(watch)).toBeUndefined();
    expect(isTimeToHangUp(watch, 1_000_000)).toBe(false);
  });

  it('counts a score at the threshold, and not one under it', () => {
    expect(after([{ type: 'vadScore', score: USER_SPEECH_THRESHOLD }], ARMED_AT_ZERO).armed).toBe(false);
    // A fridge, a car, a breath: under the threshold is the room, not an answer.
    const room = after([{ type: 'vadScore', score: 0.3 }], ARMED_AT_ZERO);
    expect(room).toBe(ARMED_AT_ZERO);
  });

  it('ignores a score that is not a number', () => {
    expect(after([{ type: 'vadScore', score: Number.NaN }], ARMED_AT_ZERO)).toBe(ARMED_AT_ZERO);
  });

  it('calls it off when they say or type something', () => {
    // A transcript, or a line typed where there is no microphone to score.
    const watch = after([{ type: 'userSpoke' }], ARMED_AT_ZERO);

    expect(watch.armed).toBe(false);
    expect(hangUpDueAt(watch)).toBeUndefined();
  });

  it('is armed again by the next finished request', () => {
    const watch = after([{ type: 'userSpoke' }, { type: 'hangUpRequested', at: 10_000 }], ARMED_AT_ZERO);

    expect(hangUpDueAt(watch)).toBe(10_000 + QUIET_BEFORE_HANGING_UP_MS);
  });
});

/** His own voice through the speaker, scored as the user: the rule `vad-score.ts` keeps too. */
describe('what is heard while Jarvis speaks', () => {
  it('does not call it off', () => {
    const watch = after(
      [
        { type: 'jarvisSpeaking', speaking: true, at: 1_000 },
        { type: 'vadScore', score: 0.95 },
        { type: 'jarvisSpeaking', speaking: false, at: 2_000 },
      ],
      ARMED_AT_ZERO,
    );

    expect(watch.armed).toBe(true);
    expect(isTimeToHangUp(watch, 2_000 + QUIET_BEFORE_HANGING_UP_MS)).toBe(true);
  });

  it('is only ignored while he speaks: the user is heard again once he stops', () => {
    const watch = after(
      [
        { type: 'jarvisSpeaking', speaking: true, at: 1_000 },
        { type: 'jarvisSpeaking', speaking: false, at: 2_000 },
        { type: 'vadScore', score: 0.7 },
      ],
      ARMED_AT_ZERO,
    );

    expect(watch.armed).toBe(false);
  });

  it('remembers that he is speaking while not armed, so a call arriving mid-sentence waits', () => {
    const watch = after([
      { type: 'jarvisSpeaking', speaking: true, at: 0 },
      { type: 'hangUpRequested', at: 100 },
      { type: 'vadScore', score: 0.9 },
    ]);

    expect(watch.armed).toBe(true);
    expect(hangUpDueAt(watch)).toBeUndefined();
  });
});

describe('the session ending', () => {
  it('disarms, so nothing is left to end a conversation that is already over', () => {
    const watch = after([{ type: 'sessionOver' }], ARMED_AT_ZERO);

    expect(watch.armed).toBe(false);
    expect(hangUpDueAt(watch)).toBeUndefined();
    expect(isTimeToHangUp(watch, 1_000_000)).toBe(false);
  });

  it('leaves the next session unarmed until its own first finished request', () => {
    // A disconnect, an error, or a new summoning: the quiet of the old call must not end the new one.
    const next = after(
      [{ type: 'sessionOver' }, { type: 'jarvisSpeaking', speaking: false, at: 5_000 }],
      ARMED_AT_ZERO,
    );

    expect(hangUpDueAt(next)).toBeUndefined();
  });

  it('is nothing to a hang-up that was not armed', () => {
    expect(afterQuietEvent(NOT_WATCHING, { type: 'sessionOver' })).toBe(NOT_WATCHING);
    expect(afterQuietEvent(NOT_WATCHING, { type: 'userSpoke' })).toBe(NOT_WATCHING);
    expect(afterQuietEvent(NOT_WATCHING, { type: 'vadScore', score: 1 })).toBe(NOT_WATCHING);
  });
});

describe('a text-only conversation', () => {
  it('hangs up the window after the call, since nothing there is ever spoken or scored', () => {
    const watch = after([{ type: 'hangUpRequested', at: 1_000 }]);

    expect(isTimeToHangUp(watch, 1_000 + QUIET_BEFORE_HANGING_UP_MS)).toBe(true);
  });

  it('keeps the call when a line is sent inside the window', () => {
    const watch = after([{ type: 'hangUpRequested', at: 1_000 }, { type: 'userSpoke' }]);

    expect(isTimeToHangUp(watch, 1_000_000)).toBe(false);
  });
});

describe('the state it is given', () => {
  it('is left alone', () => {
    // It lives in a React ref and state; mutating the previous value is how a change goes unseen.
    const before: QuietWatch = { armed: true, jarvisSpeaking: false, quietSince: 0 };
    afterQuietEvent(before, { type: 'jarvisSpeaking', speaking: true, at: 10 });
    afterQuietEvent(before, { type: 'userSpoke' });
    afterQuietEvent(before, { type: 'sessionOver' });

    expect(before).toEqual({ armed: true, jarvisSpeaking: false, quietSince: 0 });
  });
});
