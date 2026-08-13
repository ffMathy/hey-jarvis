import { describe, expect, it } from 'bun:test';
import { renderInBatches } from './tools';

/** Mirrors the error Home Assistant returns when a template renders too much output. */
const OVERFLOW = 'Error rendering template: Template output exceeded maximum size of 262144 characters';

describe('renderInBatches', () => {
  it('returns an empty result for no items without calling render', async () => {
    let calls = 0;
    const result = await renderInBatches([], 25, async (batch) => {
      calls++;
      return batch;
    });

    expect(result).toEqual([]);
    expect(calls).toBe(0);
  });

  it('splits items into batches of the requested size and preserves order', async () => {
    const sizes: number[] = [];
    const items = Array.from({ length: 7 }, (_, i) => i);

    const result = await renderInBatches(items, 3, async (batch) => {
      sizes.push(batch.length);
      return batch;
    });

    expect(sizes).toEqual([3, 3, 1]);
    expect(result).toEqual(items);
  });

  it('halves a batch that overflows and still returns every item in order', async () => {
    const attempted: number[][] = [];
    const items = Array.from({ length: 4 }, (_, i) => i);

    const result = await renderInBatches(items, 4, async (batch) => {
      attempted.push([...batch]);
      // Anything wider than two items is too much for one render.
      if (batch.length > 2) {
        throw new Error(OVERFLOW);
      }
      return batch;
    });

    expect(result).toEqual(items);
    expect(attempted).toEqual([
      [0, 1, 2, 3],
      [0, 1],
      [2, 3],
    ]);
  });

  it('keeps halving until each batch fits', async () => {
    const rendered: number[][] = [];
    const items = Array.from({ length: 8 }, (_, i) => i);

    const result = await renderInBatches(items, 8, async (batch) => {
      if (batch.length > 1) {
        throw new Error(OVERFLOW);
      }
      rendered.push([...batch]);
      return batch;
    });

    expect(result).toEqual(items);
    expect(rendered).toHaveLength(8);
  });

  it('rethrows an overflow that a single item cannot escape', async () => {
    await expect(
      renderInBatches([1, 2], 2, async () => {
        throw new Error(OVERFLOW);
      }),
    ).rejects.toThrow('exceeded maximum size');
  });

  it('does not split on unrelated errors', async () => {
    let calls = 0;

    await expect(
      renderInBatches([1, 2, 3, 4], 4, async () => {
        calls++;
        throw new Error('Home Assistant API error: Unauthorized');
      }),
    ).rejects.toThrow('Unauthorized');

    expect(calls).toBe(1);
  });
});
