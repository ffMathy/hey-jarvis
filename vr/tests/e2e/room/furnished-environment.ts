import { SyntheticEnvironmentModule } from '@iwer/sem';
import type { XRDevice } from 'iwer';
import {
  BackSide,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { type FurnishingReport, furnishRoom } from './furnishings';
import { ROOM_ASSETS_PATH } from './room-assets';
import { readRoomLayout } from './room-layout';

/**
 * Meta's Synthetic Environment Module, with the room it plays as passthrough drawn as a real room.
 *
 * Everything the emulator tells a page about the room is still Meta's module's — the planes,
 * furniture boxes and room scan it reports, its hit tests and its depth — so the app sees exactly
 * what it saw before. Only the picture behind the app's canvas is this class's: where the module
 * draws the room scan's triangles in flat grey, this draws the same room furnished from photographs
 * (`furnishings.ts`), so the pictures the specs take of him look like a headset's.
 *
 * It is installed with `device.installSEM(FurnishedEnvironmentModule)`, IWER's own way in for an
 * environment module, and draws on a canvas of its own, which the emulator puts behind the app's.
 */
export class FurnishedEnvironmentModule extends SyntheticEnvironmentModule {
  readonly #device: XRDevice;
  readonly #renderer = new WebGLRenderer({ antialias: true });
  readonly #scene = new Scene();
  readonly #camera = new PerspectiveCamera(50, 1, 0.05, 60);
  /** What the last frame drawn was drawn from; the room stands still, so an unchanged view is not drawn again. */
  #drawn: { position: Vector3; quaternion: Quaternion; fov: number; width: number; height: number } | undefined;
  #furnishings: FurnishingReport | undefined;

  constructor(device: XRDevice) {
    super(device);
    this.#device = device;
    // IWER sizes the app's canvas in CSS pixels whatever the device pixel ratio; so is this one, to match.
    this.#renderer.setPixelRatio(1);
    this.#renderer.outputColorSpace = SRGBColorSpace;
    this.#renderer.toneMapping = NeutralToneMapping;
    this.#renderer.toneMappingExposure = 1.35;
    const canvas = this.#renderer.domElement;
    canvas.style.position = 'fixed';
    canvas.style.top = '50vh';
    canvas.style.left = '50vw';
    canvas.style.transform = 'translate(-50%, -50%)';
    RectAreaLightUniformsLib.init();
    // No reflection map: generating one cost SwiftShader seconds on every page the specs open, for
    // reflections nobody could see in a matte room. The sky and the floor's bounce light it instead.
    this.#scene.add(new HemisphereLight(0xf2f5f8, 0xb59a7a, 1.4));
  }

  override get environmentCanvas(): HTMLCanvasElement {
    return this.#renderer.domElement;
  }

  /** What was put in the room, once it is loaded. */
  get furnishings(): FurnishingReport | undefined {
    return this.#furnishings;
  }

  override render(): void {
    const dimensions = this.#device.canvasDimensions;
    const width = dimensions?.width ?? window.innerWidth;
    const height = dimensions?.height ?? window.innerHeight;
    const fov = (this.#device.fovy / Math.PI) * 180;
    const position = new Vector3(this.#device.position.x, this.#device.position.y, this.#device.position.z);
    const { x, y, z, w } = this.#device.quaternion;
    const quaternion = new Quaternion(x, y, z, w);
    const drawn = this.#drawn;
    if (
      drawn !== undefined &&
      drawn.width === width &&
      drawn.height === height &&
      drawn.fov === fov &&
      drawn.position.equals(position) &&
      drawn.quaternion.equals(quaternion)
    ) {
      return;
    }
    if (drawn?.width !== width || drawn.height !== height) this.#renderer.setSize(width, height);
    this.#camera.aspect = width / height;
    this.#camera.fov = fov;
    this.#camera.updateProjectionMatrix();
    this.#camera.position.copy(position);
    this.#camera.quaternion.copy(quaternion);
    this.#renderer.render(this.#scene, this.#camera);
    this.#drawn = { position, quaternion, fov, width, height };
  }

  /** Loads the capture as Meta's module does, then furnishes it; settles once the room can be photographed. */
  override async loadDefaultEnvironment(environmentId: string): Promise<void> {
    await super.loadDefaultEnvironment(environmentId);
    const layout = readRoomLayout(this.trackedPlanes, this.trackedMeshes);
    const furnishings = await furnishRoom(layout, ROOM_ASSETS_PATH);
    this.#scene.add(outsideOf(furnishings.outside), furnishings.object);
    // The first frame drawn compiles every program and uploads every texture, which SwiftShader takes
    // seconds over. Left to the first frame of a session, that work blocked whatever a spec did first in
    // the room — a click on the page's button timed out under it — so it is drawn now, and the room is
    // ready only once the GPU has finished it.
    this.#drawn = undefined;
    this.render();
    const context = this.#renderer.getContext();
    // three 0.186 draws with WebGL 2 alone, whatever its types still allow.
    if (!(context instanceof WebGL2RenderingContext)) throw new Error('The room is drawn without WebGL 2.');
    await finished(context);
    this.#furnishings = furnishings.report;
  }
}

/** How far out the park is drawn: far enough that walking round the room shows no parallax in it. */
const OUTSIDE_RADIUS_METRES = 30;

/**
 * The park outside, as the inside of a sphere round the room rather than the scene's background: a
 * background photograph is turned into a cube map first, seconds of SwiftShader's time on every page.
 * Drawn as photographed, without the room's exposure, which is for the lit room.
 */
function outsideOf(photograph: Texture) {
  const sphere = new Mesh(
    new SphereGeometry(OUTSIDE_RADIUS_METRES, 64, 32),
    new MeshBasicMaterial({ map: photograph, side: BackSide, toneMapped: false, depthWrite: false }),
  );
  // Seen from inside, a sphere's texture is mirrored; this turns the park the right way round again.
  sphere.scale.x = -1;
  sphere.name = 'outside';
  return sphere;
}

/** Settles once the GPU has carried out everything asked of `context` so far, without blocking the page. */
function finished(context: WebGL2RenderingContext): Promise<void> {
  const fence = context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (fence === null) return Promise.reject(new Error("The room's WebGL context gave no fence to wait on."));
  context.flush();
  return new Promise((resolve, reject) => {
    const check = () => {
      const status = context.clientWaitSync(fence, 0, 0);
      if (status === context.TIMEOUT_EXPIRED) {
        setTimeout(check, FENCE_POLL_MILLISECONDS);
        return;
      }
      context.deleteSync(fence);
      if (status === context.WAIT_FAILED) reject(new Error("Waiting for the room's first frame failed."));
      else resolve();
    };
    check();
  });
}

/** How often the fence is looked at: often enough to cost the room nothing next to the seconds it waits. */
const FENCE_POLL_MILLISECONDS = 50;
