import { CanvasTexture, Mesh, MeshBasicMaterial, type Object3D, PlaneGeometry, SRGBColorSpace } from 'three';
import { layoutPanel } from './text-layout';
import { UI_COLOURS } from './ui-colours';

/**
 * Words in the room: a flat panel of text that can be put anywhere in the scene.
 *
 * Drawn with a 2D canvas into a texture on a plane, because there is no DOM in an immersive
 * session and three has no text of its own. The canvas is sized in pixels per metre of panel, at
 * about the density a Quest 3 shows at arm's length, so text read from a metre away is as crisp as
 * the display can make it and no crisper — a larger canvas would only be filtered back down.
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

/**
 * Canvas pixels per metre of panel.
 *
 * A Quest 3 shows about 25 pixels per degree; a metre-wide panel a metre away spans some 53°, so
 * about 1300 display pixels. A little over that leaves room for the panel being nearer than a
 * metre, and for the texture filtering to have something to average.
 */
export const PIXELS_PER_METRE = 1500;

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

/** Traces a rounded rectangle, by hand: `roundRect` is newer than some 2D contexts. */
function roundedRectangle(context: CanvasRenderingContext2D, width: number, height: number, radius: number) {
  const corner = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(corner, 0);
  context.arcTo(width, 0, width, height, corner);
  context.arcTo(width, height, 0, height, corner);
  context.arcTo(0, height, 0, 0, corner);
  context.arcTo(0, 0, width, 0, corner);
  context.closePath();
}

/** The canvas's 2D context, which every browser with WebXR has. */
export function drawingContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('This browser cannot draw text for the room.');
  return context;
}

/** A panel `widthMetres` wide at most, in `tone`. Hidden until it has text. */
export function createTextPanel(options: { widthMetres: number; tone: PanelTone }): TextPanel {
  const style = TONES[options.tone];
  const canvas = document.createElement('canvas');
  const context = drawingContext(canvas);

  const fontPixels = Math.round(style.fontMetres * PIXELS_PER_METRE);
  const lineHeight = Math.round(fontPixels * style.lineSpacing);
  const padding = Math.round(fontPixels * 0.7);
  const font = `${style.weight} ${fontPixels}px ${style.font}`;

  const material = new MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false, toneMapped: false });
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
      maxWidth: Math.round(options.widthMetres * PIXELS_PER_METRE) - 2 * padding,
      measure: (line) => context.measureText(line).width,
      lineHeight,
      padding,
      maxLines: style.maxLines,
      fitToText: style.fitToText,
    });
    const width = Math.ceil(layout.width);
    const height = Math.ceil(layout.height);
    // A canvas changing size needs a texture of the new size; the same size keeps the texture and
    // only uploads it again.
    const resized = canvas.width !== width || canvas.height !== height;
    canvas.width = width;
    canvas.height = height;

    context.clearRect(0, 0, width, height);
    roundedRectangle(context, width, height, padding);
    context.fillStyle = style.backing;
    context.fill();
    if (style.border !== undefined) {
      context.lineWidth = Math.max(2, Math.round(fontPixels * 0.08));
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
      texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      material.map = texture;
      material.needsUpdate = true;
    } else {
      texture.needsUpdate = true;
    }
    widthMetres = width / PIXELS_PER_METRE;
    heightMetres = height / PIXELS_PER_METRE;
    mesh.scale.set(widthMetres, heightMetres, 1);
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
