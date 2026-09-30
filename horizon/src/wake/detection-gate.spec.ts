import { describe, expect, it } from 'bun:test';
import { createDetectionGate, REFRACTORY_CHUNKS, WAKE_THRESHOLD } from './detection-gate';

/** Scores fed one per chunk; the indices of the chunks that woke him. */
function wakesFor(gate: ReturnType<typeof createDetectionGate>, scores: number[]) {
  const wakes: number[] = [];
  scores.forEach((score, index) => {
    if (gate.observe(score)) wakes.push(index);
  });
  return wakes;
}

const QUIET = 0.01;
const LOUD = 0.95;

describe('the detection gate', () => {
  it('is disarmed until armed', () => {
    const gate = createDetectionGate();
    expect(gate.armed).toBe(false);
    expect(wakesFor(gate, Array(40).fill(LOUD))).toEqual([]);
  });

  it('wakes at the threshold, not below it', () => {
    const below = createDetectionGate();
    below.arm();
    expect(wakesFor(below, [...Array(REFRACTORY_CHUNKS).fill(QUIET), WAKE_THRESHOLD - 0.001])).toEqual([]);
    const at = createDetectionGate();
    at.arm();
    expect(wakesFor(at, [...Array(REFRACTORY_CHUNKS).fill(QUIET), WAKE_THRESHOLD])).toEqual([REFRACTORY_CHUNKS]);
  });

  it('waits 2 s of audio after being armed', () => {
    const gate = createDetectionGate();
    gate.arm();
    // Loud from the first chunk: nothing until 25 chunks (2 s) have passed.
    expect(wakesFor(gate, Array(REFRACTORY_CHUNKS + 1).fill(LOUD))).toEqual([REFRACTORY_CHUNKS]);
  });

  it('wakes once for a run of high scores, and again only 2 s later', () => {
    const gate = createDetectionGate();
    gate.arm();
    const scores = [...Array(30).fill(QUIET), ...Array(7).fill(LOUD), ...Array(30).fill(QUIET), LOUD];
    expect(wakesFor(gate, scores)).toEqual([30, 67]);
  });

  it('restarts the pause when armed again', () => {
    const gate = createDetectionGate();
    gate.arm();
    wakesFor(gate, Array(40).fill(QUIET));
    gate.arm();
    expect(wakesFor(gate, Array(REFRACTORY_CHUNKS).fill(LOUD))).toEqual([]);
  });

  it('stops waking when disarmed', () => {
    const gate = createDetectionGate();
    gate.arm();
    wakesFor(gate, Array(40).fill(QUIET));
    gate.disarm();
    expect(gate.armed).toBe(false);
    expect(wakesFor(gate, [LOUD])).toEqual([]);
  });

  it('takes its threshold and pause as options', () => {
    const gate = createDetectionGate(0.8, 2);
    gate.arm();
    expect(wakesFor(gate, [0.9, 0.9, 0.7, 0.9, 0.9, 0.9, 0.9])).toEqual([3, 6]);
  });
});
