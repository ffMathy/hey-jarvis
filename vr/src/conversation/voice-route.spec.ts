import { describe, expect, it } from 'bun:test';
import {
  chooseVoiceRoute,
  createVoiceRouter,
  describeVoiceRouteReason,
  SETTLE_AFTER_MOVING_MS,
  type VoiceRouteChoice,
  type VoiceRouteReason,
} from './voice-route';

/** A headset whose microphone has its own echo canceller, with the setting on. */
const CAN_PLACE_HIM: VoiceRouteChoice = { setting: true, forced: false, echoCanceller: 'platform', webAudio: true };

function clock() {
  let time = 0;
  return {
    now: () => time,
    advance: (milliseconds: number) => {
      time += milliseconds;
    },
  };
}

describe('chooseVoiceRoute', () => {
  it('places him where he stands only when the headset cancels echo itself', () => {
    expect(chooseVoiceRoute(CAN_PLACE_HIM)).toEqual({ route: 'spatial', reason: 'platform-echo-canceller' });
    expect(chooseVoiceRoute({ ...CAN_PLACE_HIM, echoCanceller: 'browser' })).toEqual({
      route: 'element',
      reason: 'browser-echo-canceller',
    });
    expect(chooseVoiceRoute({ ...CAN_PLACE_HIM, echoCanceller: 'unknown' })).toEqual({
      route: 'element',
      reason: 'echo-canceller-unknown',
    });
  });

  it('lets the flag try it whatever the microphone said, but never over the user’s own "off"', () => {
    expect(chooseVoiceRoute({ ...CAN_PLACE_HIM, echoCanceller: 'browser', forced: true })).toEqual({
      route: 'spatial',
      reason: 'forced',
    });
    expect(chooseVoiceRoute({ ...CAN_PLACE_HIM, forced: true, setting: false })).toEqual({
      route: 'element',
      reason: 'setting-off',
    });
  });

  it('keeps him on the headset with the setting off, or with no panner to place him with', () => {
    expect(chooseVoiceRoute({ ...CAN_PLACE_HIM, setting: false })).toEqual({ route: 'element', reason: 'setting-off' });
    expect(chooseVoiceRoute({ ...CAN_PLACE_HIM, webAudio: false, forced: true })).toEqual({
      route: 'element',
      reason: 'no-web-audio',
    });
  });
});

describe('the voice router', () => {
  it('moves him to the headset once, and says so', () => {
    const time = clock();
    const router = createVoiceRouter(time.now, CAN_PLACE_HIM);
    expect(router.route).toBe('spatial');

    expect(router.demote('echo-transcript')).toBe(true);
    expect(router.route).toBe('element');
    expect(router.reason).toBe('echo-transcript');

    // Already on the headset: a second sign changes nothing, and keeps the first reason.
    expect(router.demote('spatial-silent')).toBe(false);
    expect(router.reason).toBe('echo-transcript');
  });

  it('never demotes a voice that was on the headset to begin with', () => {
    const router = createVoiceRouter(clock().now, { ...CAN_PLACE_HIM, echoCanceller: 'browser' });
    expect(router.demote('echo-early-interruption')).toBe(false);
    expect(router.reason).toBe('browser-echo-canceller');
  });

  it('holds a demotion for every room after it on the page, and the setting still switches it off', () => {
    const router = createVoiceRouter(clock().now, CAN_PLACE_HIM);
    router.demote('echo-unexplained-interruptions');

    router.choose(CAN_PLACE_HIM);
    expect(router.route).toBe('element');
    expect(router.reason).toBe('echo-unexplained-interruptions');

    router.choose({ ...CAN_PLACE_HIM, setting: false });
    expect(router.reason).toBe('setting-off');
    router.choose(CAN_PLACE_HIM);
    expect(router.reason).toBe('echo-unexplained-interruptions');
  });

  it('chooses again for a new room when nothing has been held against him', () => {
    const router = createVoiceRouter(clock().now, { ...CAN_PLACE_HIM, setting: false });
    expect(router.route).toBe('element');
    router.choose(CAN_PLACE_HIM);
    expect(router.route).toBe('spatial');
  });

  it('keeps the half-duplex fallback from judging while he is spatial and while the canceller settles', () => {
    const time = clock();
    const router = createVoiceRouter(time.now, CAN_PLACE_HIM);
    expect(router.halfDuplexMayJudge()).toBe(false);

    time.advance(60_000);
    router.demote('echo-early-interruption');
    expect(router.halfDuplexMayJudge()).toBe(false);
    time.advance(SETTLE_AFTER_MOVING_MS - 1);
    expect(router.halfDuplexMayJudge()).toBe(false);
    time.advance(1);
    expect(router.halfDuplexMayJudge()).toBe(true);
  });

  it('lets the fallback judge from the start on a headset whose voice was never spatial', () => {
    const router = createVoiceRouter(clock().now, { ...CAN_PLACE_HIM, echoCanceller: 'unknown' });
    expect(router.halfDuplexMayJudge()).toBe(true);
  });
});

describe('describeVoiceRouteReason', () => {
  it('has words for every reason, short enough for the HUD', () => {
    const reasons: VoiceRouteReason[] = [
      'platform-echo-canceller',
      'forced',
      'setting-off',
      'browser-echo-canceller',
      'echo-canceller-unknown',
      'no-web-audio',
      'echo-early-interruption',
      'echo-unexplained-interruptions',
      'echo-transcript',
      'context-not-running',
      'spatial-silent',
    ];
    const words = reasons.map(describeVoiceRouteReason);
    expect(new Set(words).size).toBe(reasons.length);
    for (const line of words) expect(line.length).toBeLessThanOrEqual(34);
  });
});
