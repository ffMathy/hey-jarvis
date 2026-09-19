import { describe, expect, it } from 'bun:test';
import { afterMessage, readingMilliseconds, SAYING_NOTHING, type WrittenReply } from './written-reply';

/** A moment to measure from, so every expectation below is an exact number rather than a range. */
const NOW = 1_000_000;

describe('afterMessage', () => {
  it('shows what Jarvis said', () => {
    expect(afterMessage(SAYING_NOTHING, { message: 'Good evening.', role: 'ai' }, NOW).shown).toBe('Good evening.');
  });

  it('replaces what he said before with what he said last', () => {
    const answered: WrittenReply = { shown: 'Good evening.', readingUntil: NOW };
    expect(afterMessage(answered, { message: 'The lights are on.', role: 'ai' }, NOW).shown).toBe('The lights are on.');
  });

  it('clears his answer the moment you send something', () => {
    // Otherwise the last thing he said sits under the line you just typed, reading as a reply to
    // it. Showing nothing while he thinks is the honest version of that.
    const answered: WrittenReply = { shown: 'Good evening.', readingUntil: NOW + 5000 };
    expect(afterMessage(answered, { message: 'What is the time?', role: 'user' }, NOW)).toEqual(SAYING_NOTHING);
  });

  it('stops him mid-sentence when you send something', () => {
    const speaking: WrittenReply = { shown: 'Good evening.', readingUntil: NOW + 5000 };
    expect(afterMessage(speaking, { message: 'Never mind.', role: 'user' }, NOW).readingUntil).toBe(0);
  });

  it('keeps his answer when a blank line arrives from him', () => {
    // Corrections and partial turns come through the same callback. An empty one is not him
    // saying nothing — it is him not having said anything new.
    const answered: WrittenReply = { shown: 'Good evening.', readingUntil: NOW + 5000 };
    expect(afterMessage(answered, { message: '   ', role: 'ai' }, NOW)).toEqual(answered);
  });

  it('has nothing to show when a blank line is all he has ever sent', () => {
    expect(afterMessage(SAYING_NOTHING, { message: '', role: 'ai' }, NOW).shown).toBeUndefined();
  });

  it('trims what it shows, so a reply is not laid out around its own whitespace', () => {
    expect(afterMessage(SAYING_NOTHING, { message: '  Good evening.\n', role: 'ai' }, NOW).shown).toBe('Good evening.');
  });

  it('sets him reading from the moment the answer arrives', () => {
    const reading = afterMessage(SAYING_NOTHING, { message: 'A'.repeat(140), role: 'ai' }, NOW);
    // 140 characters at fourteen a second is ten seconds.
    expect(reading.readingUntil).toBe(NOW + 10_000);
  });

  it('starts him reading again on a second identical answer', () => {
    // Two "Yes." in a row is two answers, and he says the second one too. Nothing here compares
    // what he said with what he said last, which is what makes that work.
    const first = afterMessage(SAYING_NOTHING, { message: 'Yes.', role: 'ai' }, NOW);
    const second = afterMessage(first, { message: 'Yes.', role: 'ai' }, NOW + 4000);
    expect(second.readingUntil).toBeGreaterThan(first.readingUntil);
  });
});

describe('readingMilliseconds', () => {
  it('reads at about a conversational rate', () => {
    expect(readingMilliseconds('A'.repeat(140))).toBe(10_000);
  });

  it('gives even the shortest answer a beat', () => {
    // "Yes." at fourteen characters a second is under three tenths of a second, which would read
    // as a glitch in the drawing rather than as Jarvis answering.
    expect(readingMilliseconds('Yes.')).toBe(900);
  });

  it('does not mime through a long answer for ever', () => {
    // Nothing is being played, so a sphere still speaking long after the text has been read is a
    // performance rather than an answer.
    expect(readingMilliseconds('A'.repeat(10_000))).toBe(12_000);
  });

  it('measures what he said rather than the whitespace around it', () => {
    expect(readingMilliseconds(`   ${'A'.repeat(140)}   `)).toBe(10_000);
  });
});
