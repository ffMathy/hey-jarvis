import {
  analyseFrame,
  createHologramScene,
  type HologramFrame,
  type HologramFrameState,
  SCENE_SEED,
  SPHERE_FRACTION,
} from 'hologram';
import { Group, Matrix4, type Object3D, Vector3, type WebGLRenderer } from 'three';
import { buildHologramRows } from './body-rows';
import { createBodyStrokes } from './body-strokes';
import { loadPainter, type Painter } from './canvaskit';
import { createDensityBackstop } from './density-backstop';
import { HOLOGRAM_RADIUS_METRES } from './dimensions';
import { createFlatHologram, DRAWING_SIZE_PIXELS, type DrawingSurfaceKind } from './flat-hologram';
import type { Vector3Tuple, ViewBasis } from './fragment-3d';
import { createFragmentUniforms, writeFragmentUniforms } from './fragment-glsl';
import { createFrameClock, type HologramDrive } from './frame-clock';
import { createHaloUnion, HALO_TEXELS } from './halo-union';
import { setLayerFade } from './layer-blending';
import { createRowAttributes } from './row-geometry';
import { createSparkleTexture } from './sparkle-texture';
import {
  bodyFrame,
  closeRangeFade,
  frontTowards,
  inFrame,
  type PoseLike,
  type Vector3Like,
  viewBasisTowards,
} from './view-basis';
import { createViewPlaneQuad } from './view-plane-quad';

/**
 * How he is drawn: `volumetric`, the body's strokes in true 3D with CanvasKit drawing only the
 * layers that live in the view plane; or `flat`, the phone's whole drawing on the view-plane quad
 * — the first picture this app drew, kept as the `?flat` debug switch and as the reference the
 * volumetric look is checked against.
 */
export type HologramMode = 'volumetric' | 'flat';

export interface HologramDiagnostics {
  /** Main-thread time `update` took last frame, CanvasKit included. */
  cpuMilliseconds: number;
  /** The share of the body's particles being drawn (see `density-backstop.ts`). */
  density: number;
  /** Of that, the time CanvasKit took to draw and hand over its picture. */
  canvasKitMilliseconds: number;
  /** Whether CanvasKit got a GPU surface, which is most of what its time depends on. */
  surface: DrawingSurfaceKind;
}

export interface JarvisHologram3D {
  /** Add to the scene; the app sets its position (the anchor) — the hologram turns itself to the viewer. */
  readonly object: Object3D;
  /**
   * Restarts the arrival vortex (time 0, fully present) and faces him to the viewer: every summon.
   * His front faces `towards` when it is given, and wherever the centre eye is on the next
   * `update` otherwise.
   */
  arrive(towards?: Vector3Like): void;
  /**
   * Once per XR frame, before `renderer.render`: moves his clock on, then draws what lives off the
   * screen — CanvasKit's layers and the halo union — against this frame's centre eye.
   */
  update(deltaSeconds: number, drive: HologramDrive, centreEye: PoseLike): void;
  /** Moves the clock on without drawing anything: for a preview that jumps to a moment. */
  advance(deltaSeconds: number, drive: HologramDrive): void;
  /** 0–1: 0 once he has fully gone after `leaving`. */
  readonly presence: number;
  /** His radius at rest, in metres. */
  radius: number;
  /** How much of the room behind his light hides, as a share of how bright it is (see ALPHA_FROM_LIGHT). */
  alphaFactor: number;
  mode: HologramMode;
  readonly diagnostics: HologramDiagnostics;
  /** The frame last drawn, or null before the first: for a debug readout and the browser tests. */
  readonly frame: HologramFrame | null;
  dispose(): void;
}

export interface JarvisHologramOptions {
  /** The site's base URL: CanvasKit's wasm is loaded from `vendor/` under it. */
  assetBase: URL;
  /** CanvasKit already loading, so it is not loaded twice; loaded from `assetBase` otherwise. */
  painter?: Painter | Promise<Painter>;
  /** Whether dropped frames may thin him (see `density-backstop.ts`). On unless a preview wants every frame alike. */
  densityBackstop?: boolean;
  /** Pixels across CanvasKit's picture. */
  drawingSize?: number;
}

/** Somewhere to build a 4×4 from a basis, made once rather than once a frame. */
interface PlacementScratch {
  matrix: Matrix4;
  right: Vector3;
  up: Vector3;
  front: Vector3;
}

/** A 4×4 that stands a unit cube at `centre`, turned to `basis` and scaled by `scale`. */
function placement(scratch: PlacementScratch, centre: Vector3, basis: ViewBasis, scale: number): Matrix4 {
  const { right, up, front } = scratch;
  right.fromArray(basis.right).multiplyScalar(scale);
  up.fromArray(basis.up).multiplyScalar(scale);
  front.fromArray(basis.front).multiplyScalar(scale);
  return scratch.matrix.makeBasis(right, up, front).setPosition(centre);
}

/**
 * Jarvis in three dimensions, for a three.js scene in a headset or on a desktop canvas.
 *
 * Per frame on the CPU: the phone's frame clock, `analyseFrame`, and CanvasKit drawing the layers
 * that are flat — the whorl, the core, the rim, the chips — with the body left out (density 0). On
 * the GPU: the halo union once, then per eye the view-plane quad (CanvasKit's picture Screened with
 * the halos) and the body's strokes where they really are. See horizon/AGENTS.md.
 */
export async function createJarvisHologram3D(
  renderer: WebGLRenderer,
  options: JarvisHologramOptions,
): Promise<JarvisHologram3D> {
  const painter = await (options.painter ?? loadPainter(new URL('vendor/', options.assetBase)));
  const scene = createHologramScene(SCENE_SEED);
  const flat = createFlatHologram(painter, options.drawingSize ?? DRAWING_SIZE_PIXELS, scene);
  const attributes = createRowAttributes(buildHologramRows(scene));
  const fragmentUniforms = createFragmentUniforms();
  const sparkle = createSparkleTexture(scene.textureSeed);
  const strokes = createBodyStrokes(attributes, fragmentUniforms, sparkle);
  const halo = createHaloUnion(attributes, fragmentUniforms);
  const quad = createViewPlaneQuad(1);
  const clock = createFrameClock();
  const backstop = options.densityBackstop === false ? null : createDensityBackstop();

  const object = new Group();
  object.name = 'jarvis';
  // Both are placed by hand each frame, from the anchor and the centre eye.
  quad.mesh.matrixAutoUpdate = false;
  strokes.mesh.matrixAutoUpdate = false;
  strokes.mesh.visible = false;
  object.add(quad.mesh, strokes.mesh);

  const centre = new Vector3();
  const head = new Vector3();
  const toParent = new Matrix4();
  const scratch: PlacementScratch = {
    matrix: new Matrix4(),
    right: new Vector3(),
    up: new Vector3(),
    front: new Vector3(),
  };
  let radius = HOLOGRAM_RADIUS_METRES;
  let alphaFactor = quad.mesh.material.uniforms.alphaFromLight.value;
  let mode: HologramMode = 'volumetric';
  let front: Vector3Tuple | null = null;
  let view: ViewBasis | null = null;
  let lastFrame: HologramFrame | null = null;
  const diagnostics: HologramDiagnostics = {
    cpuMilliseconds: 0,
    density: 1,
    canvasKitMilliseconds: 0,
    surface: flat.kind,
  };

  function hide() {
    quad.mesh.visible = false;
    strokes.mesh.visible = false;
    diagnostics.canvasKitMilliseconds = 0;
  }

  function placeLocally(mesh: Object3D, basis: ViewBasis, scale: number) {
    mesh.matrix.multiplyMatrices(toParent, placement(scratch, centre, basis, scale));
    mesh.matrixWorldNeedsUpdate = true;
  }

  function drawPicture(frame: HologramFrame, volumetric: boolean) {
    const started = performance.now();
    // Without the body when it is drawn on the GPU: at density 0 the drawing skips it and nothing else.
    quad.showPicture(flat.draw({ ...frame, density: volumetric ? 0 : frame.density }));
    diagnostics.canvasKitMilliseconds = performance.now() - started;
  }

  function drawBody(state: HologramFrameState, basis: ViewBasis, bodyBasis: ViewBasis, distance: number, fade: number) {
    const drawnRadius = (radius * state.radius) / SPHERE_FRACTION;
    writeFragmentUniforms(
      fragmentUniforms,
      state,
      inFrame(basis, bodyBasis),
      diagnostics.density,
      distance / drawnRadius,
    );
    halo.uniforms.radiusFraction.value = state.radius;
    halo.uniforms.texelUnits.value = 1 / (state.radius * HALO_TEXELS);
    halo.render(renderer);
    quad.showHalo(halo.texture, state.glowGain);
    strokes.uniforms.unitMetres.value = drawnRadius;
    setLayerFade(strokes.mesh.material, state.arrival * fade);
    placeLocally(strokes.mesh, bodyBasis, drawnRadius);
    strokes.mesh.visible = true;
  }

  function draw(centreEye: PoseLike) {
    object.updateWorldMatrix(true, false);
    centre.setFromMatrixPosition(object.matrixWorld);
    head.set(centreEye.position.x, centreEye.position.y, centreEye.position.z);
    front ??= frontTowards(centre, head);
    view = viewBasisTowards(centre, head, view);
    const frame = clock.frame(diagnostics.density);
    lastFrame = frame;
    const state = analyseFrame(frame, 1, scene);
    const distance = centre.distanceTo(head);
    const fade = closeRangeFade(distance, radius);
    if (state.arrival <= 0 || fade <= 0) {
      hide();
      return;
    }
    toParent.copy(object.matrixWorld).invert();
    placeLocally(quad.mesh, view, radius / SPHERE_FRACTION);
    // The phone fades him as one layer while he arrives and leaves; so does every part here.
    quad.setFade(state.arrival * fade, state.arrival);
    const volumetric = mode === 'volumetric';
    drawPicture(frame, volumetric);
    if (volumetric) {
      drawBody(state, view, bodyFrame(front), distance, fade);
    } else {
      quad.showHalo(null, 0);
      strokes.mesh.visible = false;
    }
  }

  return {
    object,
    arrive(towards) {
      clock.arrive();
      if (towards === undefined) {
        // Faced to wherever the viewer is when he is next drawn.
        front = null;
      } else {
        object.updateWorldMatrix(true, false);
        front = frontTowards(centre.setFromMatrixPosition(object.matrixWorld), towards);
      }
    },
    update(deltaSeconds, drive, centreEye) {
      const started = performance.now();
      clock.advance(deltaSeconds, drive);
      if (backstop !== null) diagnostics.density = backstop.observe(deltaSeconds);
      draw(centreEye);
      diagnostics.cpuMilliseconds = performance.now() - started;
    },
    advance(deltaSeconds, drive) {
      clock.advance(deltaSeconds, drive);
    },
    get presence() {
      return clock.presence;
    },
    get radius() {
      return radius;
    },
    set radius(metres: number) {
      radius = metres;
    },
    get alphaFactor() {
      return alphaFactor;
    },
    set alphaFactor(share: number) {
      alphaFactor = share;
      quad.mesh.material.uniforms.alphaFromLight.value = share;
      strokes.uniforms.alphaFromLight.value = share;
    },
    get mode() {
      return mode;
    },
    set mode(next: HologramMode) {
      mode = next;
    },
    diagnostics,
    get frame() {
      return lastFrame;
    },
    dispose() {
      object.removeFromParent();
      quad.dispose();
      strokes.dispose();
      halo.dispose();
      sparkle.dispose();
      flat.dispose();
    },
  };
}
