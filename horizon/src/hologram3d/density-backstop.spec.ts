import { describe, expect, it } from 'bun:test';
import { LONGEST_FRAME_SECONDS } from '../xr/xr-stage';
import { BACKSTOP_FLOOR, BACKSTOP_WINDOW, createDensityBackstop } from './density-backstop';

const FRAME = 1 / 72;

/** Thirty frames at 72 Hz, `late` of them taking twice as long. */
function window(late: number) {
  return Array.from({ length: BACKSTOP_WINDOW }, (_, frame) => (frame < late ? FRAME * 2 : FRAME));
}

describe('the dropped-frame backstop', () => {
  it('draws every particle while frames arrive on time, however long that goes on', () => {
    const backstop = createDensityBackstop();
    for (let second = 0; second < 60; second++) {
      for (const interval of window(0)) backstop.observe(interval);
    }
    expect(backstop.density).toBe(1);
  });

  it('lets two late frames in thirty go, and halves him on the third', () => {
    const backstop = createDensityBackstop();
    for (const interval of window(2)) backstop.observe(interval);
    expect(backstop.density).toBe(1);
    for (const interval of window(3)) backstop.observe(interval);
    expect(backstop.density).toBe(0.5);
  });

  it('keeps him thinned once it has, and never below an eighth', () => {
    const backstop = createDensityBackstop();
    for (let round = 0; round < 6; round++) {
      for (const interval of window(5)) backstop.observe(interval);
    }
    expect(backstop.density).toBe(BACKSTOP_FLOOR);
    for (let round = 0; round < 10; round++) {
      for (const interval of window(0)) backstop.observe(interval);
    }
    expect(backstop.density).toBe(BACKSTOP_FLOOR);
  });

  it('takes a stall for a stall — a hidden tab, a first-use shader — not for frames being dropped', () => {
    const backstop = createDensityBackstop();
    for (let stall = 0; stall < 5; stall++) backstop.observe(0.5);
    for (const interval of window(0)) backstop.observe(interval);
    expect(backstop.density).toBe(1);
  });

  it('takes a stall for a stall after the room has capped it, since that is all it is ever handed', () => {
    // The XR stage caps every step it hands on at LONGEST_FRAME_SECONDS, so a half-second hitch
    // while he is summoned — shaders compiling, the greeting and the call starting — arrives here
    // as exactly that, never as anything longer.
    const backstop = createDensityBackstop();
    for (let round = 0; round < 4; round++) {
      const intervals = window(0);
      intervals[5] = LONGEST_FRAME_SECONDS;
      intervals[12] = LONGEST_FRAME_SECONDS;
      intervals[20] = LONGEST_FRAME_SECONDS;
      for (const interval of intervals) backstop.observe(interval);
    }
    expect(backstop.density).toBe(1);
  });

  it('judges late by the fastest frames it saw, so a slower frame rate is not a dropped one', () => {
    const backstop = createDensityBackstop();
    for (let round = 0; round < 4; round++) {
      for (let frame = 0; frame < BACKSTOP_WINDOW; frame++) backstop.observe(frame % 2 === 0 ? 1 / 45 : 1 / 44);
    }
    expect(backstop.density).toBe(1);
  });
});
