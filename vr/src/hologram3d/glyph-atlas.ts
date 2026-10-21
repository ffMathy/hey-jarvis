import { GLYPH_STROKE_WIDTH, MAX_SATELLITES } from 'hologram';
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, type Texture } from 'three';
import { drawingContext } from '../ui3d/ui-canvas';

/**
 * The satellites' glyphs, drawn into one texture the satellites' shader reads (`satellites.ts`).
 *
 * A glyph is whatever SVG path its agent's vertical on the server declares, sent with every
 * `agentActivity` (`hologram`'s `agent-activity.ts`), so it cannot be written into the shader: the
 * page draws it once, with a 2D canvas's own `Path2D`, into a slot of its own, and the shader reads
 * that slot. The strokes are the phone's — `GLYPH_STROKE_WIDTH` wide, round-capped, white, to be
 * tinted in the shader — so a glyph looks the same on the screen and in the room.
 *
 * One slot for each satellite there can be ({@link MAX_SATELLITES}), side by side. A glyph keeps its
 * slot for as long as a satellite wears it, and is only drawn again into a slot a glyph no longer
 * wanted has left: a satellite that comes and goes costs one path drawn, not one a frame.
 */

/** How many pixels a slot is across. A glyph is a thumbnail in the room, seldom more than 40 across. */
export const GLYPH_SLOT_PIXELS = 128;

/** How far from a slot's middle to its edge, in glyph radii: the glyph, half a stroke and a margin. */
export const GLYPH_ATLAS_REACH = 1.15;

/** Where each glyph is: the slots as they now hold them, each wanted glyph's slot, and what to draw. */
export interface GlyphSlots {
  /** What each slot holds, `undefined` for nothing yet. */
  held: (string | undefined)[];
  /** The slot of each glyph asked for, in the order they were asked for. */
  slots: number[];
  /** The slots that now hold a glyph they did not hold before, and have to be drawn again. */
  drawn: number[];
}

/**
 * Puts each glyph `wanted` in a slot: where it already is, or else in a slot whose glyph is no longer
 * wanted. Pure. At most {@link MAX_SATELLITES} different glyphs are asked for at once, since that is
 * how many satellites there can be; any past that share the last slot.
 */
export function assignGlyphSlots(held: readonly (string | undefined)[], wanted: readonly string[]): GlyphSlots {
  const next = Array.from({ length: MAX_SATELLITES }, (_, slot) => held[slot]);
  const different = [...new Set(wanted)].slice(0, MAX_SATELLITES);
  const free = next.flatMap((glyph, slot) => (glyph === undefined || !different.includes(glyph) ? [slot] : []));
  const drawn: number[] = [];
  for (const glyph of different) {
    if (next.includes(glyph)) continue;
    const slot = free.shift();
    if (slot === undefined) break;
    next[slot] = glyph;
    drawn.push(slot);
  }
  const slots = wanted.map((glyph) => {
    const slot = next.indexOf(glyph);
    return slot < 0 ? MAX_SATELLITES - 1 : slot;
  });
  return { held: next, slots, drawn };
}

export interface GlyphAtlas {
  /** The slots side by side, white strokes on nothing, premultiplied. */
  readonly texture: Texture;
  /** The slot each of `glyphs` is drawn in, drawing any that are not yet. */
  slotsFor(glyphs: readonly string[]): number[];
  dispose(): void;
}

/** The atlas, drawn with a 2D canvas: `canvas` is the page's, made here unless one is handed in. */
export function createGlyphAtlas(canvas: HTMLCanvasElement = document.createElement('canvas')): GlyphAtlas {
  canvas.width = GLYPH_SLOT_PIXELS * MAX_SATELLITES;
  canvas.height = GLYPH_SLOT_PIXELS;
  const context = drawingContext(canvas);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = NoColorSpace;
  texture.premultiplyAlpha = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  let held: (string | undefined)[] = [];

  const draw = (slot: number, glyph: string) => {
    const scale = GLYPH_SLOT_PIXELS / 2 / GLYPH_ATLAS_REACH;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(slot * GLYPH_SLOT_PIXELS, 0, GLYPH_SLOT_PIXELS, GLYPH_SLOT_PIXELS);
    context.setTransform(scale, 0, 0, scale, (slot + 0.5) * GLYPH_SLOT_PIXELS, GLYPH_SLOT_PIXELS / 2);
    context.lineWidth = GLYPH_STROKE_WIDTH;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#ffffff';
    // A path the canvas cannot read draws as much of it as it can, and the rest is the satellite's
    // dot and halo: it is still an agent at work.
    context.stroke(new Path2D(glyph));
  };

  return {
    texture,
    slotsFor(glyphs) {
      const placed = assignGlyphSlots(held, glyphs);
      held = placed.held;
      for (const slot of placed.drawn) {
        const glyph = held[slot];
        if (glyph !== undefined) draw(slot, glyph);
      }
      if (placed.drawn.length > 0) texture.needsUpdate = true;
      return placed.slots;
    },
    dispose() {
      texture.dispose();
    },
  };
}
