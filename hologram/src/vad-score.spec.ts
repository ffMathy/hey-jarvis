import { describe, expect, it } from 'bun:test';
import { createVadScoreKeeper } from './vad-score';

/**
 * The user's presence as the listening animation reads it: ElevenLabs' latest `vad_score`, and
 * nothing else. See `vad-score.ts` for why it is kept outside React.
 */
describe("keeping ElevenLabs' latest voice-activity score", () => {
  it('reads as nobody speaking before any score has arrived', () => {
    expect(createVadScoreKeeper().latest()).toBe(0);
  });

  it('keeps only the latest score, as it arrived', () => {
    // Raw: the threshold is the drawing's to apply, so a score under it still gets through.
    const keeper = createVadScoreKeeper();
    keeper.heard(0.9);
    keeper.heard(0.2);
    expect(keeper.latest()).toBe(0.2);
  });

  it('keeps a score inside 0–1, whatever arrives', () => {
    const keeper = createVadScoreKeeper();
    keeper.heard(1.4);
    expect(keeper.latest()).toBe(1);
    keeper.heard(-0.1);
    expect(keeper.latest()).toBe(0);
    keeper.heard(Number.NaN);
    expect(keeper.latest()).toBe(0);
  });

  it('forgets, so a muted or closed microphone does not leave someone speaking', () => {
    const keeper = createVadScoreKeeper();
    keeper.heard(0.8);
    keeper.forget();
    expect(keeper.latest()).toBe(0);
  });
});

/**
 * The firmware's rule: while the speaker is playing, the microphone hears Jarvis and ElevenLabs
 * scores him as the user. So nothing heard then counts.
 */
describe('ignoring the score while Jarvis speaks', () => {
  it('reads as nobody speaking while he talks, whatever was heard before', () => {
    const keeper = createVadScoreKeeper();
    keeper.heard(0.9);
    keeper.jarvisSpeaking(true);
    expect(keeper.latest()).toBe(0);
  });

  it('throws away scores that arrive while he talks', () => {
    // His own voice through the speaker, scored as the user's.
    const keeper = createVadScoreKeeper();
    keeper.jarvisSpeaking(true);
    keeper.heard(0.95);
    expect(keeper.latest()).toBe(0);

    // And none of it is left over when he stops: the user has not been heard yet.
    keeper.jarvisSpeaking(false);
    expect(keeper.latest()).toBe(0);
  });

  it('listens again as soon as he stops', () => {
    const keeper = createVadScoreKeeper();
    keeper.jarvisSpeaking(true);
    keeper.jarvisSpeaking(false);
    keeper.heard(0.7);
    expect(keeper.latest()).toBe(0.7);
  });
});
