import { describe, expect, it } from 'bun:test';
import { createTextModeCaption, createTextOnlyCaption, createWrittenCaption } from './written-caption';

/** His line in writing, only while you write to him — the phone's text mode, without a tap. */
describe('the written caption', () => {
  function caption() {
    const shown: Array<string | undefined> = [];
    return { writing: createWrittenCaption((reply) => shown.push(reply.shown)), shown };
  }

  it('shows nothing of a spoken exchange', () => {
    const { writing, shown } = caption();
    writing.heard({ role: 'agent', message: 'Good evening, sir.' });
    expect(shown).toEqual([]);
    expect(writing.reply.shown).toBeUndefined();
  });

  it('shows his lines while the keyboard is up', () => {
    const { writing, shown } = caption();
    writing.setTyping(true);
    writing.heard({ role: 'agent', message: '  Good evening, sir. ' });
    expect(shown).toEqual(['Good evening, sir.']);
  });

  it('shows his answer to a typed line after the keyboard has gone', () => {
    const { writing, shown } = caption();
    writing.typed('Lights on');
    writing.heard({ role: 'agent', message: 'Done.' });
    expect(shown).toEqual(['Done.']);
  });

  it('clears his last line the moment a new one is typed', () => {
    const { writing, shown } = caption();
    writing.typed('Lights on');
    writing.heard({ role: 'agent', message: 'Done.' });
    writing.typed('And the heating');
    expect(shown).toEqual(['Done.', undefined]);
  });

  it('ignores the typed line coming back as a transcript, punctuation and case aside', () => {
    const { writing, shown } = caption();
    writing.typed('lights ON');
    writing.heard({ role: 'agent', message: 'Done.' });
    writing.heard({ role: 'user', message: 'Lights on.' });
    expect(shown).toEqual(['Done.']);
  });

  it('stops once the user speaks again', () => {
    const { writing, shown } = caption();
    writing.typed('Lights on');
    writing.heard({ role: 'agent', message: 'Done.' });
    writing.heard({ role: 'user', message: 'What time is it?' });
    writing.heard({ role: 'agent', message: 'Half past four.' });
    expect(shown).toEqual(['Done.', undefined]);
  });

  it('keeps his line through a blank one', () => {
    const { writing, shown } = caption();
    writing.setTyping(true);
    writing.heard({ role: 'agent', message: 'Done.' });
    writing.heard({ role: 'agent', message: '   ' });
    expect(shown).toEqual(['Done.']);
  });

  it('starts every conversation with nothing written', () => {
    const { writing, shown } = caption();
    writing.typed('Lights on');
    writing.heard({ role: 'agent', message: 'Done.' });
    writing.reset();
    writing.heard({ role: 'agent', message: 'Anything else?' });
    expect(shown).toEqual(['Done.', undefined]);
  });

  it('keeps nothing under a hologram that has gone', () => {
    const { writing, shown } = caption();
    writing.typed('Lights on');
    writing.heard({ role: 'agent', message: 'Done.' });
    writing.ended();
    expect(shown).toEqual(['Done.', undefined]);
  });
});

/** His line in writing while a phone's conversation is held in writing, and only then. */
describe('the text mode caption', () => {
  function caption() {
    const shown: Array<string | undefined> = [];
    return { textMode: createTextModeCaption((reply) => shown.push(reply.shown)), shown };
  }

  it('shows nothing while the conversation is spoken', () => {
    const { textMode, shown } = caption();
    textMode.heard({ role: 'agent', message: 'Good evening, sir.' });
    expect(shown).toEqual([]);
  });

  it('shows his lines once it is held in writing, without miming them', () => {
    const { textMode, shown } = caption();
    textMode.setTyping(true);
    textMode.heard({ role: 'agent', message: ' Good evening, sir. ' });
    expect(shown).toEqual(['Good evening, sir.']);
    // He is saying it out loud as well, so the sphere follows his voice rather than a clock.
    expect(textMode.reply.readingUntil).toBe(0);
  });

  it('clears what was written at every switch, either way', () => {
    const { textMode, shown } = caption();
    textMode.setTyping(true);
    textMode.heard({ role: 'agent', message: 'Done.' });
    textMode.setTyping(false);
    textMode.heard({ role: 'agent', message: 'Anything else?' });
    textMode.setTyping(true);
    expect(shown).toEqual(['Done.', undefined]);
  });

  it('clears his answer when a line is sent, and when the user speaks', () => {
    const { textMode, shown } = caption();
    textMode.setTyping(true);
    textMode.heard({ role: 'agent', message: 'Done.' });
    textMode.typed('And the heating');
    textMode.heard({ role: 'agent', message: 'Heating on.' });
    textMode.heard({ role: 'user', message: 'Thanks' });
    expect(shown).toEqual(['Done.', undefined, 'Heating on.', undefined]);
  });

  it('leaves the last line for the screen to take away with him', () => {
    const { textMode, shown } = caption();
    textMode.setTyping(true);
    textMode.heard({ role: 'agent', message: 'Done.' });
    textMode.ended();
    expect(shown).toEqual(['Done.']);
    expect(textMode.reply.shown).toBe('Done.');
  });

  it('starts every conversation spoken, with nothing written', () => {
    const { textMode, shown } = caption();
    textMode.setTyping(true);
    textMode.heard({ role: 'agent', message: 'Done.' });
    textMode.reset();
    textMode.heard({ role: 'agent', message: 'Anything else?' });
    expect(shown).toEqual(['Done.', undefined]);
  });
});

/** Every line he writes, in the conversation that has no voice, and how long he mimes it. */
describe('the text-only caption', () => {
  function caption() {
    let time = 1_000;
    const replies: Array<{ shown?: string; readingUntil: number }> = [];
    const written = createTextOnlyCaption(
      (reply) => replies.push(reply),
      () => time,
    );
    return {
      written,
      replies,
      wait: (milliseconds: number) => {
        time += milliseconds;
      },
    };
  }

  it('shows every line of his, and mimes it for as long as it takes to say', () => {
    const { written, replies } = caption();
    written.heard({ role: 'agent', message: 'Good evening.' });
    expect(replies).toHaveLength(1);
    expect(replies[0]?.shown).toBe('Good evening.');
    expect(replies[0]?.readingUntil).toBeGreaterThan(1_000);
  });

  it('starts the mime again when he says the same thing twice', () => {
    const { written, replies, wait } = caption();
    written.heard({ role: 'agent', message: 'Yes.' });
    wait(5_000);
    written.heard({ role: 'agent', message: 'Yes.' });
    expect(replies.map((reply) => reply.shown)).toEqual(['Yes.', 'Yes.']);
    expect(replies[1]?.readingUntil).toBeGreaterThan(replies[0]?.readingUntil ?? 0);
  });

  it('clears his answer the moment a line is sent, since nothing may echo it', () => {
    const { written, replies } = caption();
    written.heard({ role: 'agent', message: 'Good evening.' });
    written.typed('Are the lights on?');
    expect(replies.at(-1)).toEqual({ readingUntil: 0 });
  });

  it('leaves the last line for the screen to take away with him', () => {
    const { written } = caption();
    written.heard({ role: 'agent', message: 'Good evening.' });
    written.ended();
    expect(written.reply.shown).toBe('Good evening.');
  });
});
