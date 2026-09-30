import { describe, expect, it } from 'bun:test';
import { createWrittenCaption } from './written-caption';

/** His line in writing, only while you write to him — the phone's text mode, without a tap. */
describe('the written caption', () => {
  function caption() {
    const shown: Array<string | undefined> = [];
    return { writing: createWrittenCaption((text) => shown.push(text)), shown };
  }

  it('shows nothing of a spoken exchange', () => {
    const { writing, shown } = caption();
    writing.heard({ role: 'agent', message: 'Good evening, sir.' });
    expect(shown).toEqual([]);
    expect(writing.shown).toBeUndefined();
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
});
