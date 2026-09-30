import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';
import type { Vector3Like } from '../xr/ray';
import { drawingContext, PIXELS_PER_METRE } from './text-panel';
import { UI_COLOURS } from './ui-colours';

/**
 * The button on the back of the wrist, for hands without a controller's A or X: raise a wrist as if
 * to read a watch, and it stands off the back of it; touch it with the other hand's index finger to
 * start placing things, and again to stop.
 *
 * On the back and not the palm, because Meta keeps a palm-up pinch for itself on both hands — on
 * the left it opens the system menu and takes sir out of the room (`entities/hand-pose.ts`). A disc
 * like the keyboard button, with a pin in it for putting things somewhere, that fills with the
 * accent while the fingertip is on it.
 */

/** How wide it is drawn. */
export const WRIST_BUTTON_METRES = 0.045;

export interface WristButton {
  readonly object: Mesh;
  /** Stands it at `position`, facing `eye`, filled while `touched`; undefined hides it. */
  show(position: Vector3Like | undefined, eye: Vector3Like, touched: boolean): void;
  dispose(): void;
}

/** A disc with a map pin in it: accent on dark, or dark on accent while it is touched. */
function drawButton(context: CanvasRenderingContext2D, size: number, touched: boolean) {
  const middle = size / 2;
  context.clearRect(0, 0, size, size);
  context.beginPath();
  context.arc(middle, middle, middle - 2, 0, Math.PI * 2);
  context.fillStyle = touched ? UI_COLOURS.accent : 'rgba(16, 23, 37, 0.85)';
  context.fill();
  context.lineWidth = Math.max(2, size * 0.05);
  context.strokeStyle = UI_COLOURS.accent;
  context.stroke();

  const ink = touched ? UI_COLOURS.background : UI_COLOURS.text;
  const head = size * 0.16;
  const headY = size * 0.42;
  context.beginPath();
  context.moveTo(middle, size * 0.76);
  context.arc(middle, headY, head, Math.PI * 0.8, Math.PI * 0.2);
  context.closePath();
  context.fillStyle = ink;
  context.fill();
  context.beginPath();
  context.arc(middle, headY, head * 0.42, 0, Math.PI * 2);
  context.fillStyle = touched ? UI_COLOURS.accent : 'rgba(16, 23, 37, 1)';
  context.fill();
}

export function createWristButton(): WristButton {
  const size = Math.round(WRIST_BUTTON_METRES * PIXELS_PER_METRE);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = drawingContext(canvas);
  let drawnTouched: boolean | undefined;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  const mesh = new Mesh(new PlaneGeometry(WRIST_BUTTON_METRES, WRIST_BUTTON_METRES), material);
  mesh.renderOrder = 10;
  mesh.visible = false;

  return {
    object: mesh,
    show(position, eye, touched) {
      mesh.visible = position !== undefined;
      if (position === undefined) return;
      if (touched !== drawnTouched) {
        drawnTouched = touched;
        drawButton(context, size, touched);
        texture.needsUpdate = true;
      }
      mesh.position.set(position.x, position.y, position.z);
      mesh.lookAt(eye.x, eye.y, eye.z);
    },
    dispose() {
      texture.dispose();
      material.dispose();
      mesh.geometry.dispose();
    },
  };
}
