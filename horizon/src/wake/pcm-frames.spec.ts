import { describe, expect, it } from 'bun:test';
import { createFramePacker, rootMeanSquare, toInt16 } from './pcm-frames';

describe('a float sample as int16', () => {
  it('keeps int16 scale and clamps at the ends', () => {
    expect(toInt16(0)).toBe(0);
    expect(toInt16(0.5)).toBe(16384);
    expect(toInt16(-0.5)).toBe(-16384);
    expect(toInt16(1)).toBe(32767);
    expect(toInt16(-1)).toBe(-32768);
    expect(toInt16(3)).toBe(32767);
    expect(toInt16(-3)).toBe(-32768);
  });
});

describe('the frame packer', () => {
  it('makes one 1280-sample frame from ten 128-sample render quanta', () => {
    const frames: Int16Array[] = [];
    const packer = createFramePacker(1280, (frame) => frames.push(frame));
    for (let quantum = 0; quantum < 9; quantum++) packer.push(new Float32Array(128).fill(0.25));
    expect(frames).toHaveLength(0);
    packer.push(new Float32Array(128).fill(0.25));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toHaveLength(1280);
    expect(frames[0].every((sample) => sample === 8192)).toBe(true);
  });

  it('keeps samples in order across frames, each in a fresh array', () => {
    const frames: Int16Array[] = [];
    const packer = createFramePacker(4, (frame) => frames.push(frame));
    packer.push([0, 0.1, 0.2]);
    packer.push([0.3, 0.4, 0.5, 0.6, 0.7]);
    packer.pushSample(0.8);
    expect(frames.map((frame) => Array.from(frame))).toEqual([
      [0, 3277, 6554, 9830],
      [13107, 16384, 19661, 22938],
    ]);
    expect(frames[0].buffer).not.toBe(frames[1].buffer);
  });
});

describe('the level', () => {
  it('is the root mean square on the float scale', () => {
    expect(rootMeanSquare(new Int16Array(1280))).toBe(0);
    expect(rootMeanSquare(new Int16Array(1280).fill(16384))).toBeCloseTo(0.5, 6);
    expect(rootMeanSquare(Int16Array.from([16384, -16384]))).toBeCloseTo(0.5, 6);
    expect(rootMeanSquare(new Int16Array(0))).toBe(0);
  });
});
