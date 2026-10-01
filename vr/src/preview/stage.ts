import { analyseFrame, createHologramScene, type HologramFrame, SCENE_SEED, SPHERE_FRACTION } from 'hologram';
import { PerspectiveCamera, Scene, Vector2, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  ALPHA_FROM_LIGHT,
  createJarvisHologram3D,
  DISTANCE_AHEAD_METRES,
  type HologramDrive,
  type JarvisHologram3D,
  type Painter,
} from '../hologram3d';
import { createFrameClock } from '../hologram3d/frame-clock';
import { viewBasisTowards } from '../hologram3d/view-basis';
import { RENDERER_PARAMETERS } from '../xr/xr-stage';
import { createPhaseDrives, type PhaseDrive, SETTLE_SECONDS } from './phase-drives';
import { pictureStats } from './picture-stats';
import { checkPort } from './port-check';
import type {
  PortCheck,
  PortCheckRequest,
  PreviewMode,
  PreviewPhase,
  PreviewView,
  StillRequest,
  StillResult,
} from './preview-hook';

/** Anything with a frame clock to step: the hologram, or a clock of its own. */
interface Steppable {
  advance(deltaSeconds: number, drive: HologramDrive): void;
}

/** The lens: narrower than a headset's, so he fills the preview the way he fills the view in a room. */
const FIELD_OF_VIEW_DEGREES = 32;
/**
 * Where the parity camera stands, and how much it frames: far enough that his depth changes the
 * size of what is drawn by under a percent, so the picture is the phone's flat projection.
 */
const PARITY_DISTANCE_METRES = 40;
/** The fixed step a still is stepped at: a Quest's lowest frame rate. */
const STILL_STEP_SECONDS = 1 / 72;

/** Where the camera looks from, in the preview: `orbit` walks round him on its own. */
export type StageView = PreviewView | 'orbit';

export interface Stage {
  readonly hologram: JarvisHologram3D;
  readonly phase: PreviewPhase;
  setPhase(phase: PreviewPhase): void;
  setMode(mode: PreviewMode): void;
  setAlphaFactor(share: number): void;
  setView(view: StageView): void;
  /** Stops the live loop, draws one still from a fresh arrival, and measures it. */
  still(request: StillRequest): Promise<StillResult>;
  /**
   * Stops the live loop and draws a stereo pair for parallel viewing — the left eye's picture on
   * the left — `separation` metres apart, as a base64 PNG.
   */
  stereo(request: StillRequest, separation: number): Promise<string>;
  /** Stops the live loop and compares the GPU's fragment arithmetic with the CPU reference. */
  checkPort(request: PortCheckRequest): PortCheck;
  /** Back to the live loop, from `phase`. */
  resume(): void;
  pause(): void;
}

/** A fresh hologram on `renderer`, which does not thin itself: every preview frame is drawn in full. */
function newHologram(renderer: WebGLRenderer, painter: Painter) {
  return createJarvisHologram3D(renderer, { assetBase: new URL(document.baseURI), painter, densityBackstop: false });
}

/** The desktop stage: a three.js canvas with a camera you can drag round him, and the live phase loop. */
export async function createStage(canvas: HTMLCanvasElement, painter: Painter): Promise<Stage> {
  // As the headset's renderer is set up, multisampling included, plus a drawing buffer kept after
  // compositing so a test can read the pixels back and a screenshot catches the frame.
  const renderer = new WebGLRenderer({ ...RENDERER_PARAMETERS, canvas, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  const scene = new Scene();
  const camera = new PerspectiveCamera(FIELD_OF_VIEW_DEGREES, 1, 0.05, 100);
  camera.position.set(0, 0, DISTANCE_AHEAD_METRES);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.minDistance = 0.4;
  controls.maxDistance = 8;
  // For working out how large he is drawn; only the script's epochs are read from it.
  const measuringScene = createHologramScene(SCENE_SEED);

  let hologram = await newHologram(renderer, painter);
  scene.add(hologram.object);
  let phase: PreviewPhase = 'greeting';
  let secondsIntoPhase = 0;
  const drives = createPhaseDrives(() => secondsIntoPhase);
  let running = false;
  let lastTime: number | null = null;
  let mode: PreviewMode = 'volumetric';
  let alphaFactor = ALPHA_FROM_LIGHT;

  function resize() {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function frameFrom(view: PreviewView, eyeOffset: number) {
    const parity = view === 'parity';
    const distance = parity ? PARITY_DISTANCE_METRES : DISTANCE_AHEAD_METRES;
    const angle = view === 'side' ? Math.PI / 4 : 0;
    camera.fov = parity
      ? (2 * Math.atan((0.5 * hologram.radius) / SPHERE_FRACTION / distance) * 180) / Math.PI
      : FIELD_OF_VIEW_DEGREES;
    camera.near = parity ? distance / 2 : 0.05;
    camera.far = parity ? distance * 2 : 100;
    camera.position.set(Math.sin(angle) * distance, 0, Math.cos(angle) * distance);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    // One eye of a stereo pair: along the camera's own right, still looking straight ahead.
    camera.position.add(new Vector3(Math.cos(angle), 0, -Math.sin(angle)).multiplyScalar(eyeOffset));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  function render(deltaSeconds: number, drive: HologramDrive) {
    hologram.update(deltaSeconds, drive, { position: camera.position, orientation: camera.quaternion });
    renderer.render(scene, camera);
  }

  function tick(time: number) {
    if (!running) return;
    const deltaSeconds = lastTime === null ? 0 : Math.min(0.1, (time - lastTime) / 1000);
    lastTime = time;
    secondsIntoPhase += deltaSeconds;
    controls.update(deltaSeconds);
    render(deltaSeconds, drives[phase].drive);
    requestAnimationFrame(tick);
  }

  function beginPhase(next: PreviewPhase) {
    phase = next;
    secondsIntoPhase = 0;
    // A phase that is a summons starts the arrival again, and so does any phase once he has gone.
    if (drives[next].arrives || hologram.presence <= 0) hologram.arrive(camera.position);
  }

  /** Steps a clock through `seconds` of `drive` at the still rate, with the phase clock alongside. */
  function stepThrough(seconds: number, drive: PhaseDrive['drive'], clock: Steppable = hologram) {
    const steps = Math.round(seconds / STILL_STEP_SECONDS);
    for (let step = 0; step < steps; step++) {
      secondsIntoPhase += STILL_STEP_SECONDS;
      clock.advance(STILL_STEP_SECONDS, drive);
    }
  }

  /** Steps `clock` from an arrival to the moment `phase` and `seconds` name, as a still is stepped. */
  function stepToMoment(phase: PreviewPhase, seconds: number, clock: Steppable) {
    secondsIntoPhase = 0;
    if (!drives[phase].arrives) stepThrough(SETTLE_SECONDS, drives.idle.drive, clock);
    secondsIntoPhase = 0;
    stepThrough(seconds, drives[phase].drive, clock);
  }

  function measure(frame: HologramFrame) {
    const size = renderer.getDrawingBufferSize(new Vector2());
    const pixels = new Uint8Array(size.x * size.y * 4);
    const context = renderer.getContext();
    context.readPixels(0, 0, size.x, size.y, context.RGBA, context.UNSIGNED_BYTE, pixels);
    const drawnRadius = (hologram.radius * analyseFrame(frame, 1, measuringScene).radius) / SPHERE_FRACTION;
    const distance = camera.position.length();
    const halfHeight = distance * Math.tan((camera.fov * Math.PI) / 360);
    const centre = new Vector3(0, 0, 0).project(camera);
    return pictureStats(
      pixels,
      size.x,
      size.y,
      {
        centreX: ((centre.x + 1) / 2) * size.x,
        centreY: ((1 - centre.y) / 2) * size.y,
        radiusPixels: (drawnRadius / halfHeight) * (size.y / 2),
      },
      true,
    );
  }

  /** A fresh hologram — no voice tracker, thought or lattice carried over — stepped to the moment asked for. */
  async function prepareStill(request: StillRequest) {
    running = false;
    hologram.dispose();
    hologram = await newHologram(renderer, painter);
    hologram.mode = request.mode;
    hologram.alphaFactor = request.alphaFactor ?? ALPHA_FROM_LIGHT;
    scene.add(hologram.object);
    resize();
    frameFrom('front', 0);
    hologram.arrive(camera.position);
    stepToMoment(request.phase, request.seconds, hologram);
  }

  async function stereo(request: StillRequest, separation: number): Promise<string> {
    await prepareStill(request);
    // Drawn for the centre eye once, as a headset's frame is, then seen from each eye.
    frameFrom(request.view, 0);
    hologram.update(0, drives[request.phase].drive, { position: camera.position, orientation: camera.quaternion });
    const size = renderer.getDrawingBufferSize(new Vector2());
    const pair = new OffscreenCanvas(size.x * 2, size.y);
    const context = pair.getContext('2d');
    if (context === null) throw new Error('No 2D canvas to lay the pair out on.');
    context.fillStyle = request.background === 'grey' ? '#8c8c8c' : '#000000';
    context.fillRect(0, 0, pair.width, pair.height);
    for (const [eye, offset] of [
      [0, -separation / 2],
      [1, separation / 2],
    ]) {
      frameFrom(request.view, offset);
      renderer.render(scene, camera);
      context.drawImage(canvas, eye * size.x, 0);
    }
    const blob = await pair.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  async function still(request: StillRequest): Promise<StillResult> {
    await prepareStill(request);
    const drive = drives[request.phase];
    frameFrom(request.view, request.eyeOffset ?? 0);
    render(0, drive.drive);
    const frame = hologram.frame;
    if (frame === null) throw new Error('The still drew no frame.');
    return {
      stats: measure(frame),
      frame: {
        time: frame.time,
        appearance: frame.appearance,
        agitation: frame.agitation,
        burstAge: frame.burstAge,
        burstStrength: frame.burstStrength,
        hearing: frame.hearing ?? 0,
        thinking: frame.thinking,
        presence: frame.presence,
      },
      updateMilliseconds: hologram.diagnostics.cpuMilliseconds,
      canvasKitMilliseconds: hologram.diagnostics.canvasKitMilliseconds,
    };
  }

  new ResizeObserver(resize).observe(canvas);
  resize();
  beginPhase(phase);

  return {
    get hologram() {
      return hologram;
    },
    get phase() {
      return phase;
    },
    setPhase: beginPhase,
    setMode(next) {
      mode = next;
      hologram.mode = next;
    },
    setAlphaFactor(share) {
      alphaFactor = share;
      hologram.alphaFactor = share;
    },
    setView(view) {
      controls.autoRotate = view === 'orbit';
      frameFrom(view === 'orbit' ? 'front' : view, 0);
      controls.update();
    },
    still,
    stereo,
    checkPort(request) {
      running = false;
      const clock = createFrameClock();
      stepToMoment(request.phase, request.seconds, clock);
      const { angle, elevation } = request;
      const eye = {
        x: Math.sin(angle) * Math.cos(elevation),
        y: Math.sin(elevation),
        z: Math.cos(angle) * Math.cos(elevation),
      };
      return checkPort(
        renderer,
        clock.frame(1),
        viewBasisTowards({ x: 0, y: 0, z: 0 }, eye, null),
        request.eyeDistance,
      );
    },
    resume() {
      hologram.mode = mode;
      hologram.alphaFactor = alphaFactor;
      frameFrom('front', 0);
      beginPhase(phase);
      lastTime = null;
      if (!running) {
        running = true;
        requestAnimationFrame(tick);
      }
    },
    pause() {
      running = false;
    },
  };
}
