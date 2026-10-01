import { describe, expect, it } from 'bun:test';
import { isOrphaned, type OrphanCandidate, removeOrphanedAudio } from './orphaned-audio';

/** What a dropped connection leaves on the page, and only that, is cleared away. */
describe('clearing orphaned audio', () => {
  function element(srcObject: unknown) {
    const record = { paused: false, removed: false };
    const candidate: OrphanCandidate = {
      srcObject,
      pause: () => {
        record.paused = true;
      },
      remove: () => {
        record.removed = true;
      },
    };
    return { candidate, record };
  }

  const stream = (...states: string[]) => ({ getTracks: () => states.map((readyState) => ({ readyState })) });

  it('removes an element whose every track has ended', () => {
    const orphan = element(stream('ended', 'ended'));

    expect(removeOrphanedAudio([orphan.candidate])).toBe(1);
    expect(orphan.record).toEqual({ paused: true, removed: true });
    expect(orphan.candidate.srcObject).toBeNull();
  });

  it('leaves one that is still playing anything, and one playing a file rather than a stream', () => {
    const playing = element(stream('ended', 'live'));
    const file = element(null);
    const empty = element(stream());

    expect(removeOrphanedAudio([playing.candidate, file.candidate, empty.candidate])).toBe(0);
    expect(isOrphaned(playing.candidate)).toBe(false);
    expect(playing.record.removed).toBe(false);
    expect(file.record.removed).toBe(false);
    expect(empty.record.removed).toBe(false);
  });
});
