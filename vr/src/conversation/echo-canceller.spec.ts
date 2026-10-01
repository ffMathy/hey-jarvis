import { describe, expect, it } from 'bun:test';
import { probeEchoCanceller } from './echo-canceller';

/** A microphone track whose capabilities say `echoCancellation` is `modes`. */
function trackOffering(modes: unknown) {
  return { getCapabilities: () => ({ echoCancellation: modes, noiseSuppression: [true, false] }) };
}

describe('probeEchoCanceller', () => {
  it('finds the headset’s own echo canceller when the track offers to cancel everything played', () => {
    expect(probeEchoCanceller(trackOffering([true, false, 'all']))).toBe('platform');
    expect(probeEchoCanceller(trackOffering(['all', 'remote-only', true, false]))).toBe('platform');
  });

  it('finds only the browser’s when the modes leave "all" out', () => {
    expect(probeEchoCanceller(trackOffering([true, false]))).toBe('browser');
    expect(probeEchoCanceller(trackOffering([true, false, 'remote-only']))).toBe('browser');
  });

  it('knows nothing when the browser does not say', () => {
    expect(probeEchoCanceller(undefined)).toBe('unknown');
    expect(probeEchoCanceller({})).toBe('unknown');
    expect(probeEchoCanceller({ getCapabilities: () => ({}) })).toBe('unknown');
    expect(probeEchoCanceller({ getCapabilities: () => undefined })).toBe('unknown');
    expect(probeEchoCanceller(trackOffering(true))).toBe('unknown');
  });

  it('knows nothing from a track that throws when asked, as an ended one may', () => {
    const throwing = {
      getCapabilities: () => {
        throw new DOMException('The track has ended.', 'InvalidStateError');
      },
    };
    expect(probeEchoCanceller(throwing)).toBe('unknown');
  });
});
