import { describe, expect, it } from 'bun:test';
import { ELLIPSIS, layoutPanel, truncateLines, wrapParagraph } from './text-layout';

/** Every character one unit wide, so widths are character counts. */
const byCharacters = (text: string) => text.length;

describe('wrapParagraph', () => {
  it('keeps a line that fits', () => {
    expect(wrapParagraph('Say Hey Jarvis', 20, byCharacters)).toEqual(['Say Hey Jarvis']);
  });

  it('wraps at spaces, as many words to a line as fit', () => {
    expect(wrapParagraph('The API key has a space in it', 12, byCharacters)).toEqual([
      'The API key',
      'has a space',
      'in it',
    ]);
  });

  it('breaks a word too long for any line', () => {
    expect(wrapParagraph('see https://example.com/abc now', 8, byCharacters)).toEqual([
      'see',
      'https://',
      'example.',
      'com/abc',
      'now',
    ]);
  });

  it('forgives runs of whitespace and makes an empty paragraph one empty line', () => {
    expect(wrapParagraph('  two   words ', 20, byCharacters)).toEqual(['two words']);
    expect(wrapParagraph('   ', 20, byCharacters)).toEqual(['']);
  });
});

describe('truncateLines', () => {
  it('leaves lines that fit alone', () => {
    expect(truncateLines(['a', 'b'], 3, 10, byCharacters)).toEqual(['a', 'b']);
  });

  it('cuts to the limit and ends the last line kept with an ellipsis that fits', () => {
    expect(truncateLines(['first line', 'second one', 'third'], 2, 10, byCharacters)).toEqual([
      'first line',
      `second on${ELLIPSIS}`,
    ]);
  });

  it('keeps at least one line', () => {
    expect(truncateLines(['one', 'two'], 0, 10, byCharacters)).toEqual([`one${ELLIPSIS}`]);
  });
});

describe('layoutPanel', () => {
  it('narrows to its text, with padding all round', () => {
    expect(
      layoutPanel(['Say Hey Jarvis', 'or pinch'], { maxWidth: 40, measure: byCharacters, lineHeight: 2, padding: 1 }),
    ).toEqual({ lines: ['Say Hey Jarvis', 'or pinch'], width: 16, height: 6 });
  });

  it('spans the full width when asked to', () => {
    const layout = layoutPanel(['fps 72'], {
      maxWidth: 40,
      measure: byCharacters,
      lineHeight: 2,
      padding: 1,
      fitToText: false,
    });
    expect(layout.width).toBe(42);
  });

  it('wraps each paragraph and cuts the whole to the line limit', () => {
    const layout = layoutPanel(['one two three', 'four five six'], {
      maxWidth: 9,
      measure: byCharacters,
      lineHeight: 1,
      padding: 0,
      maxLines: 3,
    });
    expect(layout.lines).toEqual(['one two', 'three', `four fiv${ELLIPSIS}`]);
    expect(layout.height).toBe(3);
  });
});
