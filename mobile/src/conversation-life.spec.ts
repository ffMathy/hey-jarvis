import { describe, expect, it } from 'bun:test';
import { afterStatus, type ConversationLife, isLive, NOT_YET_OPEN } from './conversation-life';

/** Plays a run of statuses through, the way the screen hands them over one at a time. */
function watch(...statuses: string[]): ConversationLife {
  return statuses.reduce(afterStatus, NOT_YET_OPEN);
}

describe('isLive', () => {
  it('counts a conversation that is open, and one on its way to being open', () => {
    expect(isLive('connected')).toBe(true);
    expect(isLive('connecting')).toBe(true);
  });

  it('counts nothing else, including the states the SDK reports on the way out', () => {
    for (const status of ['disconnected', 'disconnecting', 'error', '']) {
      expect(isLive(status)).toBe(false);
    }
  });
});

describe('afterStatus', () => {
  it('has not ended before anything has happened', () => {
    expect(NOT_YET_OPEN).toEqual({ open: false, ended: false });
    expect(watch()).toEqual({ open: false, ended: false });
  });

  it('has not ended while the conversation is opening or open', () => {
    expect(watch('connecting')).toEqual({ open: false, ended: false });
    expect(watch('connecting', 'connected')).toEqual({ open: true, ended: false });
  });

  it('has ended once a conversation that was open is not any more', () => {
    expect(watch('connecting', 'connected', 'disconnected')).toEqual({ open: true, ended: true });
  });

  it('has ended when the conversation drops with an error rather than a goodbye', () => {
    expect(watch('connecting', 'connected', 'error')).toEqual({ open: true, ended: true });
  });

  it('has NOT ended when a conversation never opened, however it failed', () => {
    // The difference the whole fold exists for. This one leaves Jarvis on screen under the line
    // saying what went wrong; the two above take him off it. Both read `disconnected`.
    expect(watch('connecting', 'disconnected')).toEqual({ open: false, ended: false });
    expect(watch('connecting', 'error')).toEqual({ open: false, ended: false });
    expect(watch('disconnected')).toEqual({ open: false, ended: false });
  });

  it('stays ended, so a late status cannot bring him back mid-fade', () => {
    const ended = watch('connected', 'disconnected');

    expect(afterStatus(ended, 'disconnected')).toBe(ended);
    expect(afterStatus(ended, 'error')).toBe(ended);
    // Even a `connecting` that arrives afterwards: nothing on this screen retries, so it would be
    // the tail of the session that just ended rather than a new one.
    expect(afterStatus(ended, 'connecting')).toBe(ended);
  });

  it('is over being ended if a conversation is actually open again', () => {
    // Nothing on this screen retries, so this is not a state it can reach today. It is still the
    // only honest answer: an open conversation is not one that has ended, whatever came before.
    expect(afterStatus(watch('connected', 'disconnected'), 'connected')).toEqual({ open: true, ended: false });
  });

  it('is unchanged by seeing the same status again, so a screen need not track what it has seen', () => {
    const open = watch('connecting', 'connecting', 'connected');

    expect(afterStatus(open, 'connected')).toBe(open);
    expect(watch('connecting', 'connected', 'connected', 'disconnected', 'disconnected')).toEqual({
      open: true,
      ended: true,
    });
  });
});
