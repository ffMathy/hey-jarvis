/**
 * What the preview page shows the browser tests through `window.__hologramPreview`.
 *
 * Plain types and no imports, on purpose: the Playwright specs read this file, and Playwright's
 * loader cannot follow an import into the `hologram` package's TypeScript (see `dimensions.ts`).
 */

/** Everything he does, in the order a conversation goes through it. */
export const PREVIEW_PHASES = ['arriving', 'greeting', 'speaking', 'listening', 'thinking', 'idle', 'leaving'] as const;

export type PreviewPhase = (typeof PREVIEW_PHASES)[number];

/**
 * Where the camera stands: `front` where he arrived facing, 1.6 m away; `side` the same distance
 * 45° round to his left; `parity` far off in front with a long lens, so perspective all but
 * vanishes and the picture can be compared with the phone's flat one.
 */
export type PreviewView = 'front' | 'side' | 'parity';

/** What is behind him: black, as on the phone, or a mid grey standing in for a room in passthrough. */
export type PreviewBackground = 'black' | 'grey';

export type PreviewMode = 'volumetric' | 'flat';

export interface StillRequest {
  phase: PreviewPhase;
  /** How far into the phase: into the arrival for `arriving` and `greeting`, after he has arrived otherwise. */
  seconds: number;
  mode: PreviewMode;
  view: PreviewView;
  background: PreviewBackground;
  alphaFactor?: number;
  /** Metres to move the camera along its own right, for one eye of a stereo pair. */
  eyeOffset?: number;
}

/** Luma, 0–255, of the light he gives, measured about his centre in radii of his drawn size. */
export interface PictureStats {
  /** Mean luma over 0–0.5R, 0.5–0.94R and 0.94–1.25R. */
  annuli: [number, number, number];
  /** The 95th percentile of luma inside 1.25R. */
  percentile95: number;
  /** Mean luma over a grid of cells across ±1.9R, row by row from the top. */
  grid: number[];
  gridSize: number;
  /** How much of the disc inside 1.25R has any light at all. */
  litShare: number;
  radiusPixels: number;
}

export interface StillResult {
  stats: PictureStats;
  /** The frame he was drawn from, for choosing moments (a burst in flight, the lattice up). */
  frame: {
    time: number;
    appearance: number;
    agitation: number;
    burstAge: number;
    burstStrength: number;
    hearing: number;
    thinking: number;
    presence: number;
  };
  /** Main-thread time the frame's update took, and CanvasKit's share of it. */
  updateMilliseconds: number;
  canvasKitMilliseconds: number;
}

/** What comparing the GPU's fragment arithmetic with the CPU reference found, row by row. */
export interface PortCheck {
  rows: number;
  drawnOnCpu: number;
  drawnOnGpu: number;
  /** Rows one of the two drew and the other did not. */
  drawnOnOne: number;
  /** Rows both drew, in a different tier or group. */
  tierDiffers: number;
  /** In the drawing's unit, among rows both drew. */
  largestCentreError: number;
  largestAxisError: number;
}

/** A moment and a view to compare the GPU port at. */
export interface PortCheckRequest {
  phase: PreviewPhase;
  seconds: number;
  /** Radians round him to the viewer's right, and up above his middle. */
  angle: number;
  elevation: number;
}

/** Frame times in the room, as the preview's XR loop saw them. */
export interface RoomTimings {
  frames: number;
  /** Interval between XR frames, in ms, most recent last (at most the last 240). */
  intervals: number[];
  /** Main-thread time of the hologram's update each frame, in ms. */
  updates: number[];
  canvasKit: number[];
}

export interface HologramPreviewHook {
  /** Settles once CanvasKit is loaded and the first picture drawn. */
  ready: Promise<void>;
  /** Stops the live loop and draws one still, stepped from a fresh arrival at a fixed rate. */
  show(request: StillRequest): Promise<StillResult>;
  /** Runs the GPU's fragment arithmetic against the CPU reference at one moment and view. */
  checkPort(request: PortCheckRequest): Promise<PortCheck>;
  /** In the room: what he is doing there. */
  setRoomPhase(phase: PreviewPhase): void;
  readonly room: RoomTimings & { entered: boolean; phase: PreviewPhase };
}

declare global {
  interface Window {
    __hologramPreview?: HologramPreviewHook;
  }
}
