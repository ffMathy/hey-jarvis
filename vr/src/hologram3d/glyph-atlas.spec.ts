import { describe, expect, it } from 'bun:test';
import { MAX_SATELLITES } from 'hologram';
import { assignGlyphSlots } from './glyph-atlas';

const SUN = 'M 0.42 0 L 0.92 0';
const PAGE = 'M -0.62 -0.55 L 0.62 -0.55';
const PIN = 'M -0.3 0.02 L 0 0.72';

describe('which slot of the atlas each glyph is drawn in', () => {
  it('fills the slots in order, drawing each glyph once however many satellites wear it', () => {
    const placed = assignGlyphSlots([], [SUN, PAGE, SUN]);

    expect(placed.slots).toEqual([0, 1, 0]);
    expect(placed.drawn).toEqual([0, 1]);
  });

  it('keeps a glyph where it is for as long as it is wanted, and draws nothing again', () => {
    const first = assignGlyphSlots([], [SUN, PAGE]);
    const again = assignGlyphSlots(first.held, [PAGE, SUN]);

    expect(again.slots).toEqual([1, 0]);
    expect(again.drawn).toEqual([]);
  });

  it('puts a new glyph in the slot a glyph no longer wanted has left', () => {
    const first = assignGlyphSlots([], [SUN, PAGE]);
    const next = assignGlyphSlots(first.held, [PAGE, PIN]);

    expect(next.slots).toEqual([1, 0]);
    expect(next.drawn).toEqual([0]);
    expect(next.held.slice(0, 2)).toEqual([PIN, PAGE]);
  });

  it(`has room for as many different glyphs as there can be satellites, ${MAX_SATELLITES}`, () => {
    const glyphs = Array.from({ length: MAX_SATELLITES }, (_, index) => `M 0 0 L ${index} 0`);
    const placed = assignGlyphSlots([], glyphs);

    expect(new Set(placed.slots).size).toBe(MAX_SATELLITES);
    expect(placed.held).toHaveLength(MAX_SATELLITES);
  });
});
