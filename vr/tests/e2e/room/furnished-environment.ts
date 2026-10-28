import { SyntheticEnvironmentModule } from '@iwer/sem';
import type { XRDevice } from 'iwer';
import {
  EquirectangularReflectionMapping,
  HemisphereLight,
  NeutralToneMapping,
  PerspectiveCamera,
  PMREMGenerator,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
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
    const environment = new PMREMGenerator(this.#renderer);
    this.#scene.environment = environment.fromScene(new RoomEnvironment(), 0.04).texture;
    this.#scene.environmentIntensity = 0.5;
    environment.dispose();
    this.#scene.add(new HemisphereLight(0xf2f5f8, 0xb59a7a, 1.1));
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
    furnishings.outside.mapping = EquirectangularReflectionMapping;
    this.#scene.background = furnishings.outside;
    this.#scene.add(furnishings.object);
    // Every texture and program is uploaded now rather than on the first frame someone is waiting for.
    await this.#renderer.compileAsync(this.#scene, this.#camera);
    this.#furnishings = furnishings.report;
    this.#drawn = undefined;
  }
}
