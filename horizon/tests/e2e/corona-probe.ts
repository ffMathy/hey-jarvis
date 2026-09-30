import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { bloomRadiusAt, coronaRadiusAt, createCoronas, scanHeightAt } from '../../src/hologram3d/corona';

/**
 * The coronas, drawn in the page on a canvas of their own, for the browser test to photograph and
 * measure.
 *
 * Set up as the room's renderer is — alpha, premultiplied, no antialiasing — over a stage whose own
 * background stands in for what is behind: black, as on the phone, or the preview's passthrough grey.
 * The browser lays the canvas over it exactly as a headset's compositor lays the layer over the
 * camera view, so what the pictures show is what the blending does over a room. Bundled into a
 * script by the spec, like the harness, so it never reaches the production build.
 */

export type CoronaBackground = 'black' | 'grey';

export interface CoronaProbePoint {
  x: number;
  y: number;
  z: number;
}

export interface CoronaDrawRequest {
  /** Seconds on the coronas' clock. */
  time: number;
  background: CoronaBackground;
  spots: { position: CoronaProbePoint; level: number }[];
  eye: CoronaProbePoint;
  /** Where the camera looks. */
  target: CoronaProbePoint;
  /** Vertical field of view, degrees. */
  fieldOfView: number;
}

/**
 * Where each spot was drawn, in pixels from the top left: its centre, the leftmost point of its rim
 * as the shader turns it to the eye, and the rim's radius on the canvas.
 */
export interface CoronaProbeDrawn {
  spots: { x: number; y: number; leftRim: { x: number; y: number }; radiusPixels: number }[];
  size: number;
  /** Where the scan band is at the request's time, in rim radii from the middle, up positive. */
  scanHeight: number;
  /** How far out the finishing bloom is, in rim radii, or null outside it. */
  bloomRadius: number | null;
}

/** Red, green and blue, 0–255, as the page shows them with the stage behind. */
export type CoronaPixel = [number, number, number];

export interface CoronaProbe {
  draw(request: CoronaDrawRequest): CoronaProbeDrawn;
  /** One row of the picture as shown, stage and all, left to right. */
  row(y: number): CoronaPixel[];
  /** One column, top to bottom. */
  column(x: number): CoronaPixel[];
  /** How many pixels differ from the stage behind by more than `tolerance` in any channel. */
  changed(tolerance: number): number;
}

declare global {
  interface Window {
    __corona?: CoronaProbe;
  }
}

/** The picture's side, in pixels. */
const SIZE = 640;

/** What stands in for a room seen through passthrough: the preview's grey. */
const PASSTHROUGH_GREY: CoronaPixel = [0x8c, 0x8c, 0x8c];

function css(pixel: CoronaPixel): string {
  return `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
}

function setUp(): CoronaProbe {
  const stage = document.createElement('div');
  stage.id = 'stage';
  stage.style.cssText = `width:${SIZE}px;height:${SIZE}px;background:#000;position:absolute;left:0;top:0`;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%';
  stage.append(canvas);
  document.body.style.margin = '0';
  document.body.append(stage);

  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 0.05, 100);
  const coronas = createCoronas();
  scene.add(coronas.object);
  let behind: CoronaPixel = [0, 0, 0];
  let picture: ImageData | undefined;

  /** The canvas laid over the stage's colour, as the page shows it. */
  function composite(): ImageData {
    if (picture !== undefined) return picture;
    const flat = document.createElement('canvas');
    flat.width = SIZE;
    flat.height = SIZE;
    const context = flat.getContext('2d');
    if (context === null) throw new Error('No 2D canvas to composite on.');
    context.fillStyle = css(behind);
    context.fillRect(0, 0, SIZE, SIZE);
    context.drawImage(canvas, 0, 0);
    picture = context.getImageData(0, 0, SIZE, SIZE);
    return picture;
  }

  function pixelAt(image: ImageData, x: number, y: number): CoronaPixel {
    const offset = (y * SIZE + x) * 4;
    return [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
  }

  return {
    draw(request) {
      behind = request.background === 'grey' ? PASSTHROUGH_GREY : [0, 0, 0];
      stage.style.background = css(behind);
      camera.fov = request.fieldOfView;
      camera.position.set(request.eye.x, request.eye.y, request.eye.z);
      camera.lookAt(request.target.x, request.target.y, request.target.z);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      coronas.set(request.spots);
      coronas.time = request.time;
      coronas.update(0, request.eye);
      renderer.render(scene, camera);
      picture = undefined;
      const toCanvas = (point: Vector3) => {
        const projected = point.clone().project(camera);
        return { x: ((projected.x + 1) / 2) * SIZE, y: ((1 - projected.y) / 2) * SIZE };
      };
      const spots = request.spots.map((spot) => {
        const centre = new Vector3(spot.position.x, spot.position.y, spot.position.z);
        // The quad's right, as the vertex shader works it out: square to the view, level.
        const front = camera.position.clone().sub(centre).normalize();
        const up = new Vector3(0, 1, 0).addScaledVector(front, -front.y).normalize();
        const right = new Vector3().crossVectors(up, front);
        const radius = coronaRadiusAt(centre.distanceTo(camera.position));
        const middle = toCanvas(centre);
        const leftRim = toCanvas(centre.clone().addScaledVector(right, -radius));
        return { ...middle, leftRim, radiusPixels: Math.hypot(leftRim.x - middle.x, leftRim.y - middle.y) };
      });
      const bloomRadius = bloomRadiusAt(request.time) ?? null;
      return { spots, size: SIZE, scanHeight: scanHeightAt(request.time), bloomRadius };
    },
    row(y) {
      const image = composite();
      return Array.from({ length: SIZE }, (_, x) => pixelAt(image, x, Math.round(y)));
    },
    column(x) {
      const image = composite();
      return Array.from({ length: SIZE }, (_, y) => pixelAt(image, Math.round(x), y));
    },
    changed(tolerance) {
      const image = composite();
      let count = 0;
      for (let offset = 0; offset < image.data.length; offset += 4) {
        const differs =
          Math.abs(image.data[offset] - behind[0]) > tolerance ||
          Math.abs(image.data[offset + 1] - behind[1]) > tolerance ||
          Math.abs(image.data[offset + 2] - behind[2]) > tolerance;
        if (differs) count += 1;
      }
      return count;
    },
  };
}

window.__corona = setUp();
