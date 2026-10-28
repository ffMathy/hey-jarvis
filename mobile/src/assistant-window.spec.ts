import { describe, expect, it } from 'bun:test';
import { isStillTheShowing } from './assistant-window';

// A summoning from the watch, held by the phone in a pocket: the agent hung up, and the sheet's slide
// off the screen was held up until the next summoning, from the phone, resumed React Native. Finishing
// then, it put away the window that summoning had just been shown in — the greeting, and no sheet.
describe('a departure and the showing it began in', () => {
  it('speaks for the window while that is still the showing', () => {
    expect(isStillTheShowing(1, 1)).toBe(true);
  });

  it('is dropped once the window has been shown again', () => {
    expect(isStillTheShowing(1, 2)).toBe(false);
  });

  it("still speaks for the app's own activity, which is never told a showing", () => {
    expect(isStillTheShowing(undefined, undefined)).toBe(true);
  });
});
