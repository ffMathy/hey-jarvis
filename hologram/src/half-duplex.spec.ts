import { describe, expect, it } from 'bun:test';
import { createHalfDuplexDetector, INTERRUPTED_TOO_SOON_MS } from './half-duplex';

/** When his own voice coming back through the microphone gives itself away. */
describe('the half-duplex fallback', () => {
  function detector() {
    let time = 0;
    const detecting = createHalfDuplexDetector(() => time);
    return {
      detecting,
      wait: (milliseconds: number) => {
        time += milliseconds;
      },
    };
  }

  it('starts off, as every conversation gets its chance at full duplex', () => {
    expect(detector().detecting.on).toBe(false);
  });

  it('turns on when he is interrupted faster than anyone could draw breath to talk over him', () => {
    const { detecting, wait } = detector();
    detecting.agentStartedSpeaking();
    wait(INTERRUPTED_TOO_SOON_MS);
    expect(detecting.interrupted(true)).toBe(true);
  });

  it('does not count a slower interruption, or one after he had already stopped', () => {
    const slow = detector();
    slow.detecting.agentStartedSpeaking();
    slow.wait(INTERRUPTED_TOO_SOON_MS + 1);
    expect(slow.detecting.interrupted(true)).toBe(false);

    const stopped = detector();
    stopped.detecting.agentStartedSpeaking();
    expect(stopped.detecting.interrupted(false)).toBe(false);
  });

  it('turns on after two interruptions with no words from the user between them', () => {
    const { detecting, wait } = detector();
    wait(5_000);
    expect(detecting.interrupted(true)).toBe(false);
    expect(detecting.interrupted(true)).toBe(true);
  });

  it('forgives interruptions the user said something in', () => {
    const { detecting } = detector();
    detecting.interrupted(true);
    detecting.userSpoke();
    expect(detecting.interrupted(true)).toBe(false);
  });

  it('stays on for the rest of the conversation, and resets for the next', () => {
    const { detecting } = detector();
    detecting.interrupted(true);
    detecting.interrupted(true);
    detecting.userSpoke();
    expect(detecting.on).toBe(true);

    detecting.reset();
    expect(detecting.on).toBe(false);
  });
});
