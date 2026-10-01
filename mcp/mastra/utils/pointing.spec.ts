import { afterEach, describe, expect, it } from 'bun:test';
import { currentPointing, forgetPointing, reportPointing, resetPointingForTest, withPointing } from './pointing.js';

const HEADSET = {};
const OTHER_HEADSET = {};
const KITCHEN = { id: 'light.kitchen_ceiling', name: 'Kitchen ceiling' };

afterEach(() => resetPointingForTest());

describe('what sir is pointing at', () => {
  it('writes the thing into the request by its id, and leaves a request alone when he points at nothing', () => {
    expect(withPointing('Turn that on')).toBe('Turn that on');

    reportPointing(HEADSET, KITCHEN);
    expect(withPointing('Turn that on')).toBe('Turn that on (pointing at "Kitchen ceiling", id light.kitchen_ceiling)');

    reportPointing(HEADSET, { id: 'calendar.family' });
    expect(withPointing('What is on it?')).toBe('What is on it? (pointing at id calendar.family)');

    reportPointing(HEADSET, undefined);
    expect(withPointing('Turn that on')).toBe('Turn that on');
  });

  it('takes the newest report of any socket, and forgets a socket that closed', () => {
    reportPointing(HEADSET, KITCHEN);
    reportPointing(OTHER_HEADSET, { id: 'light.porch', name: 'Porch' });
    expect(currentPointing()).toEqual({ id: 'light.porch', name: 'Porch' });

    forgetPointing(OTHER_HEADSET);
    expect(currentPointing()).toEqual(KITCHEN);
  });

  it('takes nothing that could not be an id', () => {
    reportPointing(HEADSET, { id: '   ' });
    reportPointing(OTHER_HEADSET, { id: 'x'.repeat(201) });
    expect(currentPointing()).toBeUndefined();
  });
});
