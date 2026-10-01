import { Mesh, PlaneGeometry, Vector3 } from 'three';
import {
  CANVAS_MARGIN_PIXELS,
  canvasMetres,
  canvasPixels,
  createCanvasMaterial,
  createCanvasTexture,
  drawingContext,
  withMargin,
} from './ui-canvas';
import { UI_COLOURS } from './ui-colours';

/**
 * The one button in the room: a small keyboard under Jarvis while the conversation is live, which
 * a select brings the headset's keyboard up with (`xr/system-keyboard.ts`).
 *
 * Drawn rather than taken from a font, because whether a headset's fonts have a keyboard symbol
 * at all is not something to find out in front of the user. A disc, so it reads as something to
 * point at, and hit-tested as a sphere a little larger than it looks, because a pinch ray from a
 * tracked hand wobbles.
 */

/** How wide the glyph is drawn, in metres. */
export const KEYBOARD_GLYPH_METRES = 0.08;

/** How far from its centre a ray counts as pointing at it, in metres. */
export const KEYBOARD_GLYPH_REACH_METRES = 0.07;

export interface KeyboardGlyph {
  readonly object: Mesh;
  visible: boolean;
  /** Where its centre is in the room this frame, for hit-testing a select's ray. */
  centre(): Vector3;
  dispose(): void;
}

/**
 * Draws a keyboard: an outline with three rows of keys and a space bar, on a dark disc `size`
 * pixels across, the disc's rim just inside it.
 */
function drawGlyph(context: CanvasRenderingContext2D, size: number) {
  const rim = Math.max(2, size * 0.03);
  context.beginPath();
  context.arc(size / 2, size / 2, (size - rim) / 2, 0, Math.PI * 2);
  context.fillStyle = 'rgba(16, 23, 37, 0.8)';
  context.fill();
  context.lineWidth = rim;
  context.strokeStyle = UI_COLOURS.accent;
  context.stroke();

  const width = size * 0.56;
  const height = size * 0.36;
  const left = (size - width) / 2;
  const top = (size - height) / 2;
  context.lineWidth = Math.max(2, size * 0.025);
  context.strokeStyle = UI_COLOURS.text;
  context.strokeRect(left, top, width, height);

  context.fillStyle = UI_COLOURS.text;
  const key = width / 13;
  for (let row = 0; row < 3; row += 1) {
    const keys = row === 2 ? 1 : 6;
    for (let column = 0; column < keys; column += 1) {
      const keyWidth = row === 2 ? key * 5 : key;
      const x = row === 2 ? left + (width - keyWidth) / 2 : left + key * (1 + column * 2);
      const y = top + height * (0.18 + row * 0.26);
      context.fillRect(x, y, keyWidth, key * 0.9);
    }
  }
}

export interface KeyboardGlyphOptions {
  /** The renderer's most anisotropic filtering (see `ui-canvas.ts`). */
  anisotropy: number;
}

export function createKeyboardGlyph(options: KeyboardGlyphOptions): KeyboardGlyph {
  const size = canvasPixels(KEYBOARD_GLYPH_METRES);
  const canvas = document.createElement('canvas');
  canvas.width = withMargin(size);
  canvas.height = withMargin(size);
  const context = drawingContext(canvas);
  context.translate(CANVAS_MARGIN_PIXELS, CANVAS_MARGIN_PIXELS);
  drawGlyph(context, size);

  const texture = createCanvasTexture(canvas, options.anisotropy);
  const material = createCanvasMaterial(texture);
  // The glyph and its margin: the disc itself is KEYBOARD_GLYPH_METRES across.
  const plane = canvasMetres(canvas.width);
  const mesh = new Mesh(new PlaneGeometry(plane, plane), material);
  mesh.renderOrder = 10;
  mesh.visible = false;

  return {
    object: mesh,
    get visible() {
      return mesh.visible;
    },
    set visible(value: boolean) {
      mesh.visible = value;
    },
    centre() {
      return mesh.getWorldPosition(new Vector3());
    },
    dispose() {
      texture.dispose();
      material.dispose();
      mesh.geometry.dispose();
    },
  };
}
