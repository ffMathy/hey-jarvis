import {
  analyseFrame,
  createHologramScene,
  type HologramFrame,
  type HologramFrameState,
  SCENE_SEED,
  SPHERE_FRACTION,
} from 'hologram';
import {
  bodyFrame,
  buildHologramRows,
  createFragmentUniforms,
  frontTowards,
  type HaloUnionPlacement,
  haloUnionPlacement,
  inFrame,
  type Vector3Like,
  type Vector3Tuple,
  type ViewBasis,
  viewBasisTowards,
  writeFragmentUniforms,
} from 'hologram/gpu';
import { Group, Matrix4, type Object3D, Vector3, type WebGLRenderer } from 'three';
import type { PoseLike } from '../xr/ray';
import { createBodyStrokes } from './body-strokes';
import { createDensityBackstop } from './density-backstop';
import { HOLOGRAM_RADIUS_METRES } from './dimensions';
import { createFrameClock, type HologramDrive } from './frame-clock';
import { createHaloUnion } from './halo-union';
import { closeRangeFade } from './head';
import { setLayerFade } from './layer-blending';
import { createPictureTarget, NO_SATELLITES } from './picture-target';
import { createRowGeometry } from './row-geometry';
import { createSparkleTexture } from './sparkle-texture';
import { createViewPlaneQuad } from './view-plane-quad';

export interface HologramDiagnostics {
  /** Main-thread time `update` took last frame, the picture's draws included. */
  cpuMilliseconds: number;
  /** The share of the body's particles being drawn (see `density-backstop.ts`). */
  density: number;
  /**
   * Of that, the main-thread time spent issuing the picture's draws into its target: the GPU's own
   * time drawing them is not in it, since nothing waits for the GPU to finish.
   */
  pictureMilliseconds: number;
}

export interface JarvisHologram3D {
  /** Add to the scene; the app sets its position (the anchor) — the hologram turns itself to the viewer. */
  readonly object: Object3D;
  /**
   * Restarts the arrival vortex (time 0, fully present) and faces him to the viewer: every summon.
   * His front faces `towards` when it is given, and wherever the centre eye is on the next
   * `update` otherwise. The second after it is not judged for dropped frames (`settle`).
   */
  arrive(towards?: Vector3Like): void;
  /**
   * Tells the dropped-frame backstop that the next second's frames are not his to answer for: the
   * room calls it for a new display rate, on any change of the session's visibility and on every
   * frame while it is blurred (see `density-backstop.ts`).
   */
  settle(): void;
  /**
   * Once per XR frame, before `renderer.render`: moves his clock on, then draws what lives off the
   * screen — the picture of everything but his body, and the halo union — against this frame's centre eye. `displayRate`
   * is the display's own rate, when the headset says it: what the backstop judges a frame on time by.
   */
  update(deltaSeconds: number, drive: HologramDrive, centreEye: PoseLike, displayRate?: number): void;
  /** Moves the clock on without drawing anything: for a preview that jumps to a moment. */
  advance(deltaSeconds: number, drive: HologramDrive): void;
  /** 0–1: 0 once he has fully gone after `leaving`. */
  readonly presence: number;
  /** His radius at rest, in metres. */
  radius: number;
  /** How much of the room behind his light hides, as a share of how bright it is (see ALPHA_FROM_LIGHT). */
  alphaFactor: number;
  readonly diagnostics: HologramDiagnostics;
  /** The frame last drawn, or null before the first: for a debug readout and the browser tests. */
  readonly frame: HologramFrame | null;
  dispose(): void;
}

export interface JarvisHologramOptions {
  /** Whether dropped frames may thin him (see `density-backstop.ts`). On unless a preview wants every frame alike. */
  densityBackstop?: boolean;
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
 * Per frame on the CPU: the phone's frame clock and `analyseFrame`. On the GPU, all through
 * three's own context: the picture of the layers that are flat — the whorl, the core, the rim, the
 * chips, which leave the body out — into a target of its own, the halo union once, then per eye
 * the view-plane quad (the picture Screened with the halos) and the body's strokes where they
 * really are. See .claude/rules/vr-how-he-is-drawn-src-hologram3d.md.
 */
export function createJarvisHologram3D(renderer: WebGLRenderer, options: JarvisHologramOptions = {}): JarvisHologram3D {
  const scene = createHologramScene(SCENE_SEED);
  const picture = createPictureTarget(renderer);
  // One geometry for both passes that read the rows, so the GPU holds the rows once.
  const rowGeometry = createRowGeometry(buildHologramRows(scene));
  const fragmentUniforms = createFragmentUniforms();
  const sparkle = createSparkleTexture(scene.textureSeed);
  const strokes = createBodyStrokes(rowGeometry, fragmentUniforms, sparkle);
  const halo = createHaloUnion(rowGeometry, fragmentUniforms);
  const haloPlacement: HaloUnionPlacement = { texelUnits: 0, radiusFraction: 0 };
  const quad = createViewPlaneQuad(1, picture.texture);
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
  let front: Vector3Tuple | null = null;
  let view: ViewBasis | null = null;
  let lastFrame: HologramFrame | null = null;
  const diagnostics: HologramDiagnostics = {
    cpuMilliseconds: 0,
    density: 1,
    pictureMilliseconds: 0,
  };

  function hide() {
    quad.mesh.visible = false;
    strokes.mesh.visible = false;
    diagnostics.pictureMilliseconds = 0;
  }

  function placeLocally(mesh: Object3D, basis: ViewBasis, scale: number) {
    mesh.matrix.multiplyMatrices(toParent, placement(scratch, centre, basis, scale));
    mesh.matrixWorldNeedsUpdate = true;
  }

  function drawPicture(state: HologramFrameState) {
    const started = performance.now();
    picture.draw(state, NO_SATELLITES);
    quad.mesh.visible = true;
    diagnostics.pictureMilliseconds = performance.now() - started;
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
    const placement = haloUnionPlacement(state.radius, haloPlacement);
    halo.uniforms.radiusFraction.value = placement.radiusFraction;
    halo.uniforms.texelUnits.value = placement.texelUnits;
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
    const frame = clock.frame();
    lastFrame = frame;
    const state = analyseFrame(frame, 1);
    const distance = centre.distanceTo(head);
    const fade = closeRangeFade(distance, radius);
    if (state.arrival <= 0 || fade <= 0) {
      hide();
      return;
    }
    toParent.copy(object.matrixWorld).invert();
    placeLocally(quad.mesh, view, radius / SPHERE_FRACTION);
    // The phone fades him as one layer while he arrives and leaves; so does every part here.
    quad.setFade(state.arrival * fade);
    drawPicture(state);
    drawBody(state, view, bodyFrame(front), distance, fade);
  }

  return {
    object,
    arrive(towards) {
      clock.arrive();
      // A summon is the room's busiest second — first-use compiles, placement, the greeting and the
      // call starting — and none of it is the body being too much for the GPU.
      backstop?.settle();
      if (towards === undefined) {
        // Faced to wherever the viewer is when he is next drawn.
        front = null;
      } else {
        object.updateWorldMatrix(true, false);
        front = frontTowards(centre.setFromMatrixPosition(object.matrixWorld), towards);
      }
    },
    settle() {
      backstop?.settle();
    },
    update(deltaSeconds, drive, centreEye, displayRate) {
      const started = performance.now();
      clock.advance(deltaSeconds, drive);
      if (backstop !== null) diagnostics.density = backstop.observe(deltaSeconds, displayRate);
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
    diagnostics,
    get frame() {
      return lastFrame;
    },
    dispose() {
      object.removeFromParent();
      quad.dispose();
      strokes.dispose();
      halo.dispose();
      rowGeometry.dispose();
      sparkle.dispose();
      picture.dispose();
    },
  };
}
