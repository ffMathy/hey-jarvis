import { describe, expect, it } from 'bun:test';
import { chooseFrameRate } from './frame-rate';

const QUEST_3 = new Float32Array([72, 80, 90, 120]);

describe('chooseFrameRate', () => {
  it('asks for the lowest rate while there is nothing to draw', () => {
    expect(chooseFrameRate(QUEST_3, 'lowest')).toBe(72);
  });

  it('asks for the highest rate up to 90 while he is there', () => {
    expect(chooseFrameRate(QUEST_3, 'highest')).toBe(90);
    expect(chooseFrameRate([60, 72], 'highest')).toBe(72);
  });

  it('settles for the lowest when every rate is above 90', () => {
    expect(chooseFrameRate([120, 144], 'highest')).toBe(120);
  });

  it('has nothing to ask for when the headset offers no rates', () => {
    expect(chooseFrameRate(undefined, 'lowest')).toBeUndefined();
    expect(chooseFrameRate([], 'highest')).toBeUndefined();
    expect(chooseFrameRate([Number.NaN, 0], 'highest')).toBeUndefined();
  });
});
