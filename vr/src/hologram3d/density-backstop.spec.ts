import { describe, expect, it } from 'bun:test';
import { LONGEST_FRAME_SECONDS } from '../xr/xr-stage';
import {
  BACKSTOP_FIRST_WAIT_SECONDS,
  BACKSTOP_FLOOR,
  BACKSTOP_LONGEST_WAIT_SECONDS,
  BACKSTOP_SETTLE_SECONDS,
  BACKSTOP_WINDOW,
  createDensityBackstop,
  type DensityBackstop,
} from './density-backstop';

const FRAME = 1 / 72;

/** Thirty frames at 72 Hz, `late` of them taking twice as long. */
function window(late: number) {
  return Array.from({ length: BACKSTOP_WINDOW }, (_, frame) => (frame < late ? FRAME * 2 : FRAME));
}

function feed(backstop: DensityBackstop, intervals: number[]) {
  for (const interval of intervals) backstop.observe(interval);
}

/** Whole windows, `late` frames of each late, until at least `seconds` of frames have gone by. */
function feedFor(backstop: DensityBackstop, seconds: number, late = 0) {
  for (let fed = 0; fed < seconds; ) {
    const intervals = window(late);
    feed(backstop, intervals);
    for (const interval of intervals) fed += interval;
  }
}

/** Frames dropping: two bad windows running. */
function drop(backstop: DensityBackstop) {
  feed(backstop, window(5));
  feed(backstop, window(5));
}

/** Frame by frame, for `seconds`: all of them on time, or, `hitching`, every other one late. */
function feedFrames(backstop: DensityBackstop, seconds: number, hitching = false) {
  let fed = 0;
  for (let frame = 0; fed < seconds; frame++) {
    const interval = hitching && frame % 2 === 1 ? FRAME * 2 : FRAME;
    backstop.observe(interval);
    fed += interval;
  }
}

/** A 90 Hz display's period, for what a headset says its rate is. */
const NINETY = 1 / 90;

/** Thirty frames, every one of them `interval` long. */
function steadyWindow(interval: number) {
  return Array.from({ length: BACKSTOP_WINDOW }, () => interval);
}

/**
 * `windows` whole windows of frames `interval` apart, with the display's rate as the headset says
 * it, if it does. Whole windows, so that every judgement lands where the test expects it.
 */
function feedWindows(backstop: DensityBackstop, interval: number, windows: number, displayRate?: number) {
  for (let frame = 0; frame < windows * BACKSTOP_WINDOW; frame++) backstop.observe(interval, displayRate);
}

/** A backstop that frames dropping have halved once. */
function halved() {
  const backstop = createDensityBackstop();
  drop(backstop);
  expect(backstop.density).toBe(0.5);
  return backstop;
}

describe('the dropped-frame backstop', () => {
  it('draws every particle while frames arrive on time, however long that goes on', () => {
    const backstop = createDensityBackstop();
    for (let second = 0; second < 60; second++) feed(backstop, window(0));
    expect(backstop.density).toBe(1);
  });

  it('lets two late frames in thirty go, however often', () => {
    const backstop = createDensityBackstop();
    for (let round = 0; round < 100; round++) feed(backstop, window(2));
    expect(backstop.density).toBe(1);
  });

  it('takes three late frames in one window for a hitch, and halves him only on two windows running', () => {
    const backstop = createDensityBackstop();
    feed(backstop, window(3));
    expect(backstop.density).toBe(1);
    feed(backstop, window(0));
    feed(backstop, window(3));
    expect(backstop.density).toBe(1);
    feed(backstop, window(3));
    expect(backstop.density).toBe(0.5);
  });

  it('never adds up bad windows with good ones between them, however many there are', () => {
    const backstop = createDensityBackstop();
    for (let round = 0; round < 40; round++) {
      feed(backstop, window(10));
      feed(backstop, window(0));
    }
    expect(backstop.density).toBe(1);
  });

  it('counts afresh once it has halved him, so halving him again takes two more bad windows', () => {
    const backstop = halved();
    feed(backstop, window(5));
    expect(backstop.density).toBe(0.5);
    feed(backstop, window(5));
    expect(backstop.density).toBe(0.25);
  });

  it('never thins him below an eighth, however long frames keep dropping', () => {
    const backstop = createDensityBackstop();
    for (let round = 0; round < 20; round++) drop(backstop);
    expect(backstop.density).toBe(BACKSTOP_FLOOR);
  });

  it('takes a stall for a stall — a hidden tab, a first-use shader — not for frames being dropped', () => {
    const backstop = createDensityBackstop();
    for (let stall = 0; stall < 5; stall++) backstop.observe(0.5);
    feed(backstop, window(0));
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
      feed(backstop, intervals);
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

describe('judging a frame on time', () => {
  it('halves him when a display the headset says runs at 90 Hz falls to a clean 45', () => {
    const backstop = createDensityBackstop();
    feedWindows(backstop, NINETY, 3, 90);
    // Every frame of a clean 45 is as long as every other, so none of them is late against its window.
    feedWindows(backstop, NINETY * 2, 1, 90);
    expect(backstop.density).toBe(1);
    feedWindows(backstop, NINETY * 2, 1, 90);
    expect(backstop.density).toBe(0.5);
  });

  it('catches a summon that lands straight on half the display’s rate, when the headset says what it is', () => {
    const backstop = createDensityBackstop();
    backstop.settle();
    // The settled second is forty-five frames of a clean 45, and one more for rounding; the two
    // windows after it are all a clean 45 too, with nothing on time before them to judge them by.
    for (let frame = 0; frame < 46; frame++) backstop.observe(NINETY * 2, 90);
    feedWindows(backstop, NINETY * 2, 2, 90);
    expect(backstop.density).toBe(0.5);
  });

  it('takes a display the headset says is slower for a slower display, not for frames being dropped', () => {
    const backstop = createDensityBackstop();
    feedWindows(backstop, FRAME, 72, 72);
    expect(backstop.density).toBe(1);
  });

  it('catches a clean fall to half rate without the display’s rate, against the frames on time before it', () => {
    const backstop = createDensityBackstop();
    feed(backstop, steadyWindow(NINETY));
    feed(backstop, steadyWindow(NINETY * 2));
    expect(backstop.density).toBe(1);
    feed(backstop, steadyWindow(NINETY * 2));
    expect(backstop.density).toBe(0.5);
  });

  it('fails a share given back that comes back at a clean half rate, and waits twice as long', () => {
    // A window of thirty frames at 90 Hz is a third of a second.
    const windowsIn = (seconds: number) => Math.ceil(seconds * 3);
    const backstop = createDensityBackstop();
    feedWindows(backstop, NINETY, 3, 90);
    feedWindows(backstop, NINETY * 2, 2, 90);
    expect(backstop.density).toBe(0.5);
    feedWindows(backstop, NINETY, windowsIn(BACKSTOP_FIRST_WAIT_SECONDS + 1), 90);
    expect(backstop.density).toBe(1);
    // The share given back is a clean 45 again: on trial, and it fails.
    feedWindows(backstop, NINETY * 2, 2, 90);
    expect(backstop.density).toBe(0.5);
    feedWindows(backstop, NINETY, windowsIn(BACKSTOP_FIRST_WAIT_SECONDS * 2 - 1), 90);
    expect(backstop.density).toBe(0.5);
    feedWindows(backstop, NINETY, windowsIn(2), 90);
    expect(backstop.density).toBe(1);
  });

  it('takes no stray short frame for the display’s rate, without it', () => {
    const backstop = createDensityBackstop();
    const strays = steadyWindow(FRAME);
    strays[4] = FRAME / 10;
    strays[17] = FRAME / 10;
    feed(backstop, strays);
    // Judged against a tenth of a frame, every frame after it would be late.
    for (let round = 0; round < 20; round++) feed(backstop, window(2));
    expect(backstop.density).toBe(1);
  });

  it('judges by what is on time at the new rate once settled, without the display’s rate', () => {
    // From 120 Hz to 60, unsettled, every frame is late against what was on time before.
    const unsettled = createDensityBackstop();
    feed(unsettled, steadyWindow(1 / 120));
    feed(unsettled, steadyWindow(1 / 60));
    feed(unsettled, steadyWindow(1 / 60));
    expect(unsettled.density).toBe(0.5);

    const settled = createDensityBackstop();
    feed(settled, steadyWindow(1 / 120));
    settled.settle();
    feedWindows(settled, 1 / 60, 6);
    expect(settled.density).toBe(1);
  });

  it('takes 60 Hz frames under a reported 90 for an emulator on a monitor, not for frames dropped', () => {
    // A 60 Hz frame is exactly half again a 90 Hz one, and stamped to a tenth of a millisecond, as a
    // browser stamps them, two in three come out a hair longer. A dropped frame is two periods at least.
    const backstop = createDensityBackstop();
    for (let frame = 0; frame < 120 * BACKSTOP_WINDOW; frame++) backstop.observe(frame % 3 === 2 ? 0.0166 : 0.0167, 90);
    expect(backstop.density).toBe(1);
  });

  it('takes no short interval a late callback leaves behind for the display’s rate, without it', () => {
    // Three callbacks of one window run 5 ms late: each makes one long interval and one short one,
    // and nothing is dropped. Taken for a frame on time, the short ones would make every frame late.
    const backstop = createDensityBackstop();
    const jittered = steadyWindow(NINETY);
    for (const late of [5, 15, 25]) {
      jittered[late] = NINETY + 0.005;
      jittered[late + 1] = NINETY - 0.005;
    }
    feed(backstop, jittered);
    feedWindows(backstop, NINETY, 180);
    expect(backstop.density).toBe(1);
  });
});

describe('frames dropped on a beat', () => {
  /** Frames at 90 Hz with one in `every` dropped, for `windows` windows. */
  function beat(backstop: DensityBackstop, every: number, windows: number) {
    for (let frame = 0; frame < windows * BACKSTOP_WINDOW; frame++) {
      backstop.observe(frame % every === 0 ? NINETY * 2 : NINETY, 90);
    }
  }

  it('halves him when one frame in twelve is dropped, three in one window and two in the next', () => {
    const backstop = createDensityBackstop();
    beat(backstop, 12, 2);
    expect(backstop.density).toBe(0.5);
  });

  it('still lets a frame dropped in fifteen go, two a window however long it goes on', () => {
    const backstop = createDensityBackstop();
    beat(backstop, 15, 300);
    expect(backstop.density).toBe(1);
  });

  it('takes a lone bad window followed by a single late frame for a hitch', () => {
    const backstop = createDensityBackstop();
    feed(backstop, window(6));
    feed(backstop, window(1));
    feed(backstop, window(0));
    expect(backstop.density).toBe(1);
  });
});

describe('settling the backstop', () => {
  it('judges none of the second after a settle — a summon, a new display rate, the session shown again', () => {
    // The same second of hitches, unsettled, halves him: it is the settle that lets it go.
    const unsettled = createDensityBackstop();
    feedFrames(unsettled, BACKSTOP_SETTLE_SECONDS * 0.9, true);
    feedFor(unsettled, 2);
    expect(unsettled.density).toBe(0.5);

    const settled = createDensityBackstop();
    settled.settle();
    feedFrames(settled, BACKSTOP_SETTLE_SECONDS * 0.9, true);
    feedFor(settled, 2);
    expect(settled.density).toBe(1);
  });

  it('judges frames again once the second is over', () => {
    const backstop = createDensityBackstop();
    backstop.settle();
    feedFor(backstop, BACKSTOP_SETTLE_SECONDS + 0.1);
    drop(backstop);
    expect(backstop.density).toBe(0.5);
  });

  it('never pairs a bad window before a settle with one after it', () => {
    const backstop = createDensityBackstop();
    feed(backstop, window(5));
    backstop.settle();
    feedFor(backstop, BACKSTOP_SETTLE_SECONDS + 0.1);
    feed(backstop, window(5));
    feed(backstop, window(0));
    expect(backstop.density).toBe(1);
  });

  it('throws away a window a settle cut in two, rather than finishing it with frames from after', () => {
    const backstop = createDensityBackstop();
    // Two thirds of a window, ten of its frames late.
    for (let frame = 0; frame < 20; frame++) backstop.observe(frame < 10 ? FRAME * 2 : FRAME);
    backstop.settle();
    feedFor(backstop, BACKSTOP_SETTLE_SECONDS + 0.1);
    feed(backstop, window(5));
    feed(backstop, window(0));
    expect(backstop.density).toBe(1);
  });
});

describe('giving the particles back', () => {
  it(`doubles the share after ${BACKSTOP_FIRST_WAIT_SECONDS} seconds without frames dropping`, () => {
    const backstop = halved();
    feedFor(backstop, BACKSTOP_FIRST_WAIT_SECONDS - 1);
    expect(backstop.density).toBe(0.5);
    feedFor(backstop, 2);
    expect(backstop.density).toBe(1);
  });

  it('climbs back from the floor one doubling at a time', () => {
    const backstop = createDensityBackstop();
    for (let round = 0; round < 3; round++) drop(backstop);
    expect(backstop.density).toBe(BACKSTOP_FLOOR);
    for (const share of [0.25, 0.5, 1]) {
      feedFor(backstop, BACKSTOP_FIRST_WAIT_SECONDS + 1);
      expect(backstop.density).toBe(share);
    }
  });

  it('never gives him more than all of them', () => {
    const backstop = halved();
    feedFor(backstop, BACKSTOP_LONGEST_WAIT_SECONDS * 2);
    expect(backstop.density).toBe(1);
  });

  it('lets a lone bad window go by without holding the share back', () => {
    const backstop = halved();
    // One bad window in every four, for 14 seconds: never ten seconds of good windows on end.
    for (let round = 0; round < 8; round++) {
      feed(backstop, window(10));
      for (let good = 0; good < 3; good++) feed(backstop, window(0));
    }
    expect(backstop.density).toBe(1);
  });

  it('counts no stall and no settled second towards the wait, since neither is him being drawn', () => {
    const backstop = halved();
    for (let stall = 0; stall < BACKSTOP_FIRST_WAIT_SECONDS * 20; stall++) backstop.observe(LONGEST_FRAME_SECONDS);
    for (let settle = 0; settle < BACKSTOP_FIRST_WAIT_SECONDS * 2; settle++) {
      backstop.settle();
      feedFrames(backstop, BACKSTOP_SETTLE_SECONDS * 0.9);
    }
    expect(backstop.density).toBe(0.5);
  });

  it('halves him again when a share given back drops frames, and waits twice as long before the next try', () => {
    const backstop = halved();
    feedFor(backstop, BACKSTOP_FIRST_WAIT_SECONDS + 1);
    expect(backstop.density).toBe(1);
    drop(backstop);
    expect(backstop.density).toBe(0.5);
    feedFor(backstop, BACKSTOP_FIRST_WAIT_SECONDS * 2 - 1);
    expect(backstop.density).toBe(0.5);
    feedFor(backstop, 2);
    expect(backstop.density).toBe(1);
  });

  it(`never waits longer than ${BACKSTOP_LONGEST_WAIT_SECONDS} seconds, however often the share given back fails`, () => {
    const backstop = halved();
    for (const wait of [10, 20, 40, 80, 160, 160, 160]) {
      feedFor(backstop, wait - 1);
      expect(backstop.density).toBe(0.5);
      feedFor(backstop, 2);
      expect(backstop.density).toBe(1);
      drop(backstop);
      expect(backstop.density).toBe(0.5);
    }
  });

  it('goes back to the first wait once a share given back has held for as long as it was waited for', () => {
    const backstop = halved();
    feedFor(backstop, BACKSTOP_FIRST_WAIT_SECONDS + 1);
    drop(backstop);
    feedFor(backstop, BACKSTOP_FIRST_WAIT_SECONDS * 2 + 1);
    expect(backstop.density).toBe(1);
    // On trial for the twenty seconds it was waited for, and it holds.
    feedFor(backstop, BACKSTOP_FIRST_WAIT_SECONDS * 2);
    drop(backstop);
    expect(backstop.density).toBe(0.5);
    feedFor(backstop, BACKSTOP_FIRST_WAIT_SECONDS + 1);
    expect(backstop.density).toBe(1);
  });

  it('never passes a trial on a window that is dropping frames: the next decides, and it fails', () => {
    // Frames at 80 Hz under a reported 90 are on time, and a window of them is 0.375 s, so no wait
    // ends exactly on a window: ten seconds is 26.7 windows, twenty is 53.3.
    const EIGHTY = 1 / 80;
    const backstop = createDensityBackstop();
    feedWindows(backstop, EIGHTY, 3, 90);
    feedWindows(backstop, NINETY * 2, 2, 90);
    expect(backstop.density).toBe(0.5);
    feedWindows(backstop, EIGHTY, 27, 90);
    expect(backstop.density).toBe(1);
    // On trial for ten seconds: it holds for 9.75 of them, then falls to a clean 45 in the window
    // that would have completed them.
    feedWindows(backstop, EIGHTY, 26, 90);
    feedWindows(backstop, NINETY * 2, 1, 90);
    expect(backstop.density).toBe(1);
    feedWindows(backstop, NINETY * 2, 1, 90);
    expect(backstop.density).toBe(0.5);
    // Failed on trial, so the next try waits twenty seconds rather than ten.
    feedWindows(backstop, EIGHTY, 53, 90);
    expect(backstop.density).toBe(0.5);
    feedWindows(backstop, EIGHTY, 1, 90);
    expect(backstop.density).toBe(1);
  });

  it('takes frames dropping late in a trial for the share failing too', () => {
    const backstop = halved();
    feedFor(backstop, BACKSTOP_FIRST_WAIT_SECONDS + 1);
    // Most of the way through the ten seconds the share is on trial for.
    feedFor(backstop, BACKSTOP_FIRST_WAIT_SECONDS - 3);
    drop(backstop);
    feedFor(backstop, BACKSTOP_FIRST_WAIT_SECONDS + 1);
    expect(backstop.density).toBe(0.5);
  });
});
