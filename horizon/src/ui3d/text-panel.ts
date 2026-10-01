import { type CanvasTexture, Mesh, type Object3D, PlaneGeometry } from 'three';
import { layoutPanel } from './text-layout';
import {
  CANVAS_MARGIN_PIXELS,
  canvasMetres,
  canvasPixels,
  createCanvasMaterial,
  createCanvasTexture,
  drawingContext,
  roundedRectangle,
  withMargin,
} from './ui-canvas';
import { UI_COLOURS } from './ui-colours';

/**
 * Words in the room: a flat panel of text that can be put anywhere in the scene.
 *
 * Drawn with a 2D canvas into a texture on a plane, because there is no DOM in an immersive
 * session and three has no text of its own. The canvas is sized in pixels per metre of panel, at
 * about the density a Quest 3 shows at arm's length, so text read from a metre away is as crisp as
 * the display can make it and no crisper — a larger canvas would only be filtered back down. How it
 * is filtered, and why its outline is drawn inside a transparent margin, is `ui-canvas.ts`'s.
 *
 * Every panel has a translucent dark backing. Passthrough is whatever the room happens to be, and
 * light text straight over a white wall or a window cannot be read; the backing hides a little of
 * the room behind the words, and only there.
 */

/** What a panel is for, which decides its size, colour and backing. */
export type PanelTone = 'hint' | 'status' | 'guide' | 'error' | 'caption' | 'toast' | 'hud' | 'label';

export interface TextPanel {
  readonly object: Object3D;
  /** Replaces the text; nothing is redrawn when the lines are the same. Undefined empties and hides it. */
  setText(lines: readonly string[] | undefined): void;
  visible: boolean;
  /** The panel's current size, in metres. */
  readonly widthMetres: number;
  readonly heightMetres: number;
  dispose(): void;
}

interface ToneStyle {
  /** Letter height, in metres. */
  fontMetres: number;
  lineSpacing: number;
  font: string;
  weight: number;
  text: string;
  backing: string;
  border: string | undefined;
  maxLines: number;
  fitToText: boolean;
  align: CanvasTextAlign;
  uppercase: boolean;
}

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONOSPACE = 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace';

/**
 * The tones. Sizes are chosen for the distance each is read from: the hint, the status line and
 * the placing guide a little over a metre ahead, the error and the caption at his spot (1–2.5 m),
 * the HUD at arm's length and only by whoever asked for it, and a label on a thing sir placed from
 * wherever he stands — near enough to reach, or across the room at what he points at.
 */
const TONES: Record<PanelTone, ToneStyle> = {
  hint: {
    fontMetres: 0.034,
    lineSpacing: 1.35,
    font: SANS,
    weight: 400,
    text: UI_COLOURS.text,
    backing: 'rgba(5, 7, 13, 0.55)',
    border: undefined,
    maxLines: 3,
    fitToText: true,
    align: 'center',
    uppercase: false,
  },
  status: {
    fontMetres: 0.026,
    lineSpacing: 1.35,
    font: SANS,
    weight: 400,
    text: UI_COLOURS.text,
    backing: 'rgba(5, 7, 13, 0.7)',
    border: UI_COLOURS.danger,
    maxLines: 4,
    fitToText: true,
    align: 'center',
    uppercase: false,
  },
  // The status line's size, framed in the colour of sir's own doing rather than of a warning.
  guide: {
    fontMetres: 0.024,
    lineSpacing: 1.35,
    font: SANS,
    weight: 400,
    text: UI_COLOURS.text,
    backing: 'rgba(5, 7, 13, 0.7)',
    border: UI_COLOURS.accent,
    maxLines: 5,
    fitToText: true,
    align: 'center',
    uppercase: false,
  },
  error: {
    fontMetres: 0.034,
    lineSpacing: 1.35,
    font: SANS,
    weight: 500,
    text: UI_COLOURS.text,
    backing: 'rgba(16, 23, 37, 0.85)',
    border: UI_COLOURS.danger,
    maxLines: 8,
    fitToText: false,
    align: 'center',
    uppercase: false,
  },
  caption: {
    fontMetres: 0.03,
    lineSpacing: 1.35,
    font: SANS,
    weight: 400,
    text: UI_COLOURS.text,
    backing: 'rgba(5, 7, 13, 0.6)',
    border: undefined,
    maxLines: 6,
    fitToText: true,
    align: 'center',
    uppercase: false,
  },
  toast: {
    fontMetres: 0.03,
    lineSpacing: 1.3,
    font: SANS,
    weight: 500,
    text: UI_COLOURS.text,
    backing: 'rgba(5, 7, 13, 0.45)',
    border: undefined,
    maxLines: 1,
    fitToText: true,
    align: 'center',
    uppercase: true,
  },
  hud: {
    fontMetres: 0.012,
    lineSpacing: 1.3,
    font: MONOSPACE,
    weight: 400,
    text: UI_COLOURS.success,
    backing: 'rgba(5, 7, 13, 0.8)',
    border: UI_COLOURS.border,
    maxLines: 40,
    fitToText: false,
    align: 'left',
    uppercase: false,
  },
  label: {
    fontMetres: 0.018,
    lineSpacing: 1.25,
    font: SANS,
    weight: 500,
    text: UI_COLOURS.text,
    backing: 'rgba(5, 7, 13, 0.72)',
    border: UI_COLOURS.accent,
    maxLines: 2,
    fitToText: true,
    align: 'center',
    uppercase: false,
  },
};

export interface TextPanelOptions {
  /** The widest it may be, in metres; lines wrap to fit. */
  widthMetres: number;
  tone: PanelTone;
  /** The renderer's most anisotropic filtering (see `ui-canvas.ts`). */
  anisotropy: number;
}

/** A panel `widthMetres` wide at most, in `tone`. Hidden until it has text. */
export function createTextPanel(options: TextPanelOptions): TextPanel {
  const style = TONES[options.tone];
  const canvas = document.createElement('canvas');
  const context = drawingContext(canvas);

  const fontPixels = canvasPixels(style.fontMetres);
  const lineHeight = Math.round(fontPixels * style.lineSpacing);
  const padding = Math.round(fontPixels * 0.7);
  const font = `${style.weight} ${fontPixels}px ${style.font}`;
  const borderPixels = Math.max(2, Math.round(fontPixels * 0.08));

  const material = createCanvasMaterial(null);
  const mesh = new Mesh(new PlaneGeometry(1, 1), material);
  // Drawn after everything else, and never hidden by it: text that his glow could cover is text
  // that could not be read at the moment it matters.
  mesh.renderOrder = 10;
  mesh.visible = false;
  let texture: CanvasTexture | undefined;
  let shown = '';
  let widthMetres = 0;
  let heightMetres = 0;

  function draw(lines: readonly string[]) {
    context.font = font;
    const text = style.uppercase ? lines.map((line) => line.toUpperCase()) : lines;
    const layout = layoutPanel(text, {
      maxWidth: canvasPixels(options.widthMetres) - 2 * padding,
      measure: (line) => context.measureText(line).width,
      lineHeight,
      padding,
      maxLines: style.maxLines,
      fitToText: style.fitToText,
    });
    const width = Math.ceil(layout.width);
    const height = Math.ceil(layout.height);
    // A canvas changing size needs a texture of the new size; the same size keeps the texture and
    // only uploads it again. Setting the size clears the canvas and its drawing state either way.
    const canvasWidth = withMargin(width);
    const canvasHeight = withMargin(height);
    const resized = canvas.width !== canvasWidth || canvas.height !== canvasHeight;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    context.translate(CANVAS_MARGIN_PIXELS, CANVAS_MARGIN_PIXELS);

    roundedRectangle(context, 0, 0, width, height, padding);
    context.fillStyle = style.backing;
    context.fill();
    if (style.border !== undefined) {
      // Inside the backing's outline, so the border's outer edge is the panel's.
      const inset = borderPixels / 2;
      roundedRectangle(context, inset, inset, width - borderPixels, height - borderPixels, padding - inset);
      context.lineWidth = borderPixels;
      context.strokeStyle = style.border;
      context.stroke();
    }
    context.font = font;
    context.fillStyle = style.text;
    context.textAlign = style.align;
    context.textBaseline = 'middle';
    const x = style.align === 'left' ? padding : width / 2;
    layout.lines.forEach((line, index) => {
      context.fillText(line, x, padding + lineHeight * (index + 0.5));
    });

    if (resized || texture === undefined) {
      texture?.dispose();
      texture = createCanvasTexture(canvas, options.anisotropy);
      material.uniforms.picture.value = texture;
    } else {
      texture.needsUpdate = true;
    }
    // The panel's size is its backing's; the plane is a margin larger all round.
    widthMetres = canvasMetres(width);
    heightMetres = canvasMetres(height);
    mesh.scale.set(canvasMetres(canvasWidth), canvasMetres(canvasHeight), 1);
  }

  return {
    object: mesh,
    setText(lines) {
      if (lines === undefined || lines.length === 0) {
        shown = '';
        mesh.visible = false;
        return;
      }
      const key = lines.join('\n');
      if (key !== shown) {
        shown = key;
        draw(lines);
      }
      mesh.visible = true;
    },
    get visible() {
      return mesh.visible;
    },
    set visible(value: boolean) {
      mesh.visible = value && shown !== '';
    },
    get widthMetres() {
      return widthMetres;
    },
    get heightMetres() {
      return heightMetres;
    },
    dispose() {
      texture?.dispose();
      material.dispose();
      mesh.geometry.dispose();
    },
  };
}
