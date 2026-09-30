import { describe, expect, it } from 'bun:test';
import { splitTypedLines } from './system-keyboard';

describe('splitTypedLines', () => {
  it('has no finished line until there is a newline', () => {
    expect(splitTypedLines('What time is it')).toEqual({ lines: [], rest: 'What time is it' });
  });

  it('finishes a line at the newline, trimmed', () => {
    expect(splitTypedLines('  What time is it?  \n')).toEqual({ lines: ['What time is it?'], rest: '' });
  });

  it('keeps what is typed after the newline for the next line', () => {
    expect(splitTypedLines('Hello\nAnd ano')).toEqual({ lines: ['Hello'], rest: 'And ano' });
  });

  it('finishes several lines at once, as a paste does, and drops the empty ones', () => {
    expect(splitTypedLines('One\r\n\n  \nTwo\nthr')).toEqual({ lines: ['One', 'Two'], rest: 'thr' });
  });

  it('has nothing in nothing', () => {
    expect(splitTypedLines('')).toEqual({ lines: [], rest: '' });
  });
});
