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
 * 45° round to his left.
 */
export type PreviewView = 'front' | 'side';

/** What is behind him: black, as on the phone, or a mid grey standing in for a room in passthrough. */
export type PreviewBackground = 'black' | 'grey';

export interface StillRequest {
  phase: PreviewPhase;
  /** How far into the phase: into the arrival for `arriving` and `greeting`, after he has arrived otherwise. */
  seconds: number;
  view: PreviewView;
  background: PreviewBackground;
  alphaFactor?: number;
  /** Metres to move the camera along its own right, for one eye of a stereo pair. */
  eyeOffset?: number;
}

/** Luma, 0–255, of the light he gives, measured about his centre in radii of his drawn size. */
export interface PictureStats {
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
  /** Main-thread time the frame's update took, and the share of it spent issuing his picture's draws. */
  updateMilliseconds: number;
  pictureMilliseconds: number;
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
  /** How far the eye is from his centre, in radii. */
  eyeDistance: number;
}

/** What drawing the body with `hologram/gpu`'s raw renderer found, against three.js drawing the same moment. */
export interface GpuBodyCheck {
  /** The drawing buffer both were drawn into, in pixels. */
  width: number;
  height: number;
  /** Pixels three.js lit. */
  litPixels: number;
  /** Bytes, of R, G, B and A, and pixels in which the raw renderer's picture differs from three's. */
  differingBytes: number;
  differingPixels: number;
  /** The largest difference in any one byte, 0–255. */
  largestDifference: number;
}

/** A moment and a view to draw the body at both ways. */
export interface GpuBodyCheckRequest {
  phase: PreviewPhase;
  seconds: number;
  /** Radians round him to the viewer's right, and up above his middle. */
  angle: number;
  elevation: number;
  /** How far the eye is from his centre, in metres. */
  distance: number;
  /** How much the camera sees from top to bottom, in degrees. */
  fieldOfView: number;
}

/** A frame of him as `hologram`'s `HologramFrame` has it, spelled out so a spec can build one. */
export interface PictureFrame {
  time: number;
  level: number;
  bands: number[];
  speaking: boolean;
  agitation: number;
  burstAge: number;
  burstStrength: number;
  burstCount: number;
  appearance: number;
  presence: number;
  thinking: number;
  hearing?: number;
}

/** A satellite round him as `hologram`'s `SatelliteOrbit` has it. */
export interface PictureOrbit {
  glyph: string;
  level: number;
  flare: number;
  asking: boolean;
  turn: number;
  reach: number;
}

/** One moment of his picture: a frame, and the satellites drawn over it. */
export interface PictureMoment {
  frame: PictureFrame;
  satellites?: PictureOrbit[];
}

/** Moments to draw with the GPU picture into a `size`-pixel target of the stage's renderer. */
export interface PictureRequest {
  size: number;
  moments: PictureMoment[];
}

/** What the GPU picture drew for each moment of a {@link PictureRequest}. */
export interface DrawnPictures {
  /**
   * Each picture's pixels, base64: RGBA, premultiplied light over transparent black, bottom row
   * first as a framebuffer is read — unfaded, as the picture is always drawn.
   */
  pictures: string[];
  /** Each frame's `arrivalOf(appearance, presence)`: the fade whoever shows him lays over the picture. */
  arrivals: number[];
}

/** The numbers of `hologram`'s drawing a spec needs to build frames and measure them. */
export interface PictureFacts {
  voiceBandCount: number;
  /** His radius at rest, as a share of the square's side. */
  sphereFraction: number;
  materialiseSeconds: number;
  /** Every epoch start in the app's slow script: the moments it changes something. */
  scriptBoundaries: number[];
  /** The glyph an agent whose vertical draws none wears, and sample mode's own glyphs. */
  plainRingGlyph: string;
  sampleGlyphs: string[];
  /** How far out a satellite's orbit is, and how big its glyph, in his radii at rest. */
  screenOrbitRadii: number;
  screenGlyphRadii: number;
}

/** Where a satellite is on a screen: across to the right and up, in orbit radii from his centre. */
export interface PictureOrbitPoint {
  across: number;
  up: number;
}

/** One moment drawn with the GPU picture, to compare with Skia's picture of it, a PNG in base64. */
export interface PictureCheckRequest extends PictureMoment {
  size: number;
  golden: string;
}

/** How the GPU picture of a moment differs from Skia's, over the RGB of every pixel. */
export interface PictureCheck {
  /** Mean absolute difference per channel, 0–255. */
  meanDifference: number;
  /** The 99th percentile and the largest of the per-channel differences. */
  percentile99: number;
  largestDifference: number;
  /** Share of pixels with any channel more than 16 apart. */
  shareOver16: number;
  /** Mean Rec. 709 luma of each, 0–255. */
  meanLuma: number;
  goldenMeanLuma: number;
}

/** Frame times in the room, as the preview's XR loop saw them. */
export interface RoomTimings {
  frames: number;
  /** Interval between XR frames, in ms, most recent last (at most the last 240). */
  intervals: number[];
  /** Main-thread time of the hologram's update each frame, in ms, and of that his picture's draws. */
  updates: number[];
  pictures: number[];
}

/** A point in the room's `local-floor` space, in metres. */
export interface RoomPoint {
  x: number;
  y: number;
  z: number;
}

/** Where the preview's room is: whether it is open, what he is doing, and where he was put. */
export interface RoomStatus extends RoomTimings {
  entered: boolean;
  phase: PreviewPhase;
  /** Seconds of the room's frame time since the phase began. */
  secondsIntoPhase: number;
  /** Where his centre was put, and where the head was then. */
  placedAt: RoomPoint | null;
  headAtPlacement: RoomPoint | null;
}

export interface HologramPreviewHook {
  /** Settles once the stage is up and the first picture drawn. */
  ready: Promise<void>;
  /** Stops the live loop and draws one still, stepped from a fresh arrival at a fixed rate. */
  show(request: StillRequest): Promise<StillResult>;
  /**
   * A stereo pair of one still for parallel viewing, drawn for the centre eye and seen from eyes
   * `separation` metres apart: a base64 PNG, the left eye's picture on the left.
   */
  stereo(request: StillRequest, separation: number): Promise<string>;
  /** Runs the GPU's fragment arithmetic against the CPU reference at one moment and view. */
  checkPort(request: PortCheckRequest): Promise<PortCheck>;
  /** Draws the body at one moment and view with three.js and with the phone's raw renderer, and compares them. */
  checkGpuBody(request: GpuBodyCheckRequest): Promise<GpuBodyCheck>;
  /** Draws moments with `hologram/gpu`'s picture, as the headset draws it, and hands back their pixels. */
  drawPictures(request: PictureRequest): Promise<DrawnPictures>;
  /** The drawing's own numbers, for a spec to build its frames from. */
  pictureFacts(): Promise<PictureFacts>;
  /** Where each of `orbits` is round him at `time`, as `hologram`'s `orbitPoint` puts it. */
  orbitPoints(orbits: PictureOrbit[], time: number): Promise<PictureOrbitPoint[]>;
  /** Draws one moment with the GPU picture and compares it with Skia's picture of it. */
  checkPicture(request: PictureCheckRequest): Promise<PictureCheck>;
  /**
   * In the room: what he is doing there. With `holdAtSeconds`, the voices driving him stop at that
   * moment of the phase and stay there — he goes on moving — so a picture can be taken of it on an
   * emulator whose frames come a second apart.
   */
  setRoomPhase(phase: PreviewPhase, holdAtSeconds?: number): void;
  readonly room: RoomStatus;
  /** The satellites round him on the stage: each one's agent and status, in the order they came. */
  readonly satellites: { agentId: string; status: string }[];
}

declare global {
  interface Window {
    __hologramPreview?: HologramPreviewHook;
  }
}
