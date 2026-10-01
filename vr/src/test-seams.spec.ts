import { describe, expect, it } from 'bun:test';
import { readTestSeams } from './test-seams';

function seamsOf(query: string) {
  return readTestSeams(new URLSearchParams(query));
}

describe('readTestSeams', () => {
  it('leaves the page as a headset runs it when the URL asks for nothing', () => {
    expect(seamsOf('')).toEqual({ giveUpConnectingAfterMs: undefined, holdErrors: false });
    // The app's own flags are not seams.
    expect(seamsOf('?debug&film&origin=1,2,30')).toEqual({ giveUpConnectingAfterMs: undefined, holdErrors: false });
  });

  it('holds the connection deadline open for ?deadline=never', () => {
    expect(seamsOf('?deadline=never').giveUpConnectingAfterMs).toBe(Number.POSITIVE_INFINITY);
  });

  it('holds an error panel until it is dismissed for ?errors=held', () => {
    expect(seamsOf('?errors=held').holdErrors).toBe(true);
  });

  it('reads both at once, in either order and beside the app’s own flags', () => {
    const both = { giveUpConnectingAfterMs: Number.POSITIVE_INFINITY, holdErrors: true };
    expect(seamsOf('?deadline=never&errors=held')).toEqual(both);
    expect(seamsOf('?errors=held&debug&deadline=never')).toEqual(both);
  });

  it('holds nothing for a spelling it does not know, so a typo leaves the headset’s budgets in place', () => {
    for (const query of ['?deadline', '?deadline=', '?deadline=Never', '?deadline=forever', '?deadline=60']) {
      expect(seamsOf(query).giveUpConnectingAfterMs).toBeUndefined();
    }
    for (const query of ['?errors', '?errors=', '?errors=Held', '?errors=shown', '?errors=true']) {
      expect(seamsOf(query).holdErrors).toBe(false);
    }
  });
});
