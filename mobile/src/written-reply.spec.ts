import { describe, expect, it } from 'bun:test';
import { afterMessage } from './written-reply';

describe('afterMessage', () => {
  it('shows what Jarvis said', () => {
    expect(afterMessage(undefined, { message: 'Good evening.', role: 'ai' })).toBe('Good evening.');
  });

  it('replaces what he said before with what he said last', () => {
    expect(afterMessage('Good evening.', { message: 'The lights are on.', role: 'ai' })).toBe('The lights are on.');
  });

  it('clears his answer the moment you send something', () => {
    // Otherwise the last thing he said sits under the line you just typed, reading as a reply to
    // it. Showing nothing while he thinks is the honest version of that.
    expect(afterMessage('Good evening.', { message: 'What is the time?', role: 'user' })).toBeUndefined();
  });

  it('keeps his answer when a blank line arrives from him', () => {
    // Corrections and partial turns come through the same callback. An empty one is not him
    // saying nothing — it is him not having said anything new.
    expect(afterMessage('Good evening.', { message: '   ', role: 'ai' })).toBe('Good evening.');
  });

  it('has nothing to show when a blank line is all he has ever sent', () => {
    expect(afterMessage(undefined, { message: '', role: 'ai' })).toBeUndefined();
  });

  it('trims what it shows, so a reply is not laid out around its own whitespace', () => {
    expect(afterMessage(undefined, { message: '  Good evening.\n', role: 'ai' })).toBe('Good evening.');
  });

  it('ignores the whitespace of a line you sent, and clears anyway', () => {
    expect(afterMessage('Good evening.', { message: '  ', role: 'user' })).toBeUndefined();
  });
});
