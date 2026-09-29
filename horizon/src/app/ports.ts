import { type JarvisVoice, SILENT_VOICE, type UserVoice } from 'hologram';
import type { Object3D, WebGLRenderer } from 'three';
import type { DepthProbe } from '../xr/depth-probes';
import type { PoseLike, QuaternionLike, Vector3Like } from '../xr/ray';
import type { SessionPhase, WakeReadiness } from './app-state';

/**
 * Where the rest of the app plugs into the room: the wake word, the conversation, the hologram and
 * placement, each as the few calls the room makes of it.
 *
 * Each mirrors the surface of the module that fills it (`src/wake/`, `src/conversation/`,
 * `src/hologram3d/`, `src/room/`) — the same names and shapes, so those modules' factories can be
 * passed in as they are — but declared here, on the room's side, so the room is written and tested
 * against what it needs rather than against whatever else those modules export. Any of them can be
 * a stand-in: `milestone-zero.ts` has one for the hologram and one for placement, and a room with
 * no wake engine or no conversation simply has none.
 */

// ─────────────────────────── the wake word (src/wake/) ───────────────────────────

export type WakeState = 'unloaded' | 'loading' | 'warming' | 'ready' | 'listening' | 'broken';

/** What the wake engine says about itself, as far as the room and the HUD need it. */
export interface WakeHealthLike {
  state: WakeState;
  /** Why it is not listening, in words for the status line. */
  problem?: string;
  chunksPerSecond: number;
  millisecondsPerChunk: number;
  level: number;
  score: number;
  armed: boolean;
}

export interface WakePort {
  readonly health: WakeHealthLike;
  arm(): void;
  disarm(): void;
  onWake(listener: (score: number) => void): () => void;
  onHealth(listener: (health: WakeHealthLike) => void): () => void;
  /** Watchdog recovery; may need user activation, so the room retries it inside a select. */
  rebuild(): Promise<void>;
}

/** What the status line says while the engine is on its way to listening and has not said why not. */
export const GETTING_READY_TO_LISTEN = 'Getting ready to hear you…';

/** What it says when the engine has stopped without saying why. */
export const STOPPED_LISTENING = 'The wake word stopped working. Pinch to try again.';

/** The engine's health, folded to what the room decides by. */
export function readinessOf(health: WakeHealthLike): WakeReadiness {
  if (health.state === 'listening') return { kind: 'listening' };
  const fallback = health.state === 'broken' ? STOPPED_LISTENING : GETTING_READY_TO_LISTEN;
  return { kind: 'not-listening', problem: health.problem ?? fallback };
}

// ─────────────────────────── the conversation (src/conversation/) ───────────────────────────

export interface ConversationEvents {
  onPhase(phase: SessionPhase): void;
  /** Always followed by the phase `failed`. */
  onProblem(message: string): void;
  onCaption(text: string | undefined): void;
  onDiagnostics?(diagnostics: { status: string; mode: string; interruptions: number; halfDuplex: boolean }): void;
}

export interface ConversationPort {
  summon(): void;
  hangUp(): void;
  endQuietly(): void;
  sendText(text: string): void;
  setTyping(typing: boolean): void;
  readonly phase: SessionPhase;
  readonly voice: JarvisVoice;
  readonly user: UserVoice;
  readonly thinking: boolean;
  quietFor(seconds: number): boolean;
  dispose(): void;
}

/** Makes the room's conversation, handing it the events to report through. */
export type ConversationFactory = (events: ConversationEvents) => ConversationPort;

const NOBODY: UserVoice = { getPresence: () => 0, getVolume: () => 0 };

/**
 * A conversation that never starts: the room's when it has no ElevenLabs session to hold, as at
 * Milestone 0. He is summoned, stays idle and silent, and leaves when sent away.
 */
export function createSilentConversation(): ConversationPort {
  return {
    summon: () => undefined,
    hangUp: () => undefined,
    endQuietly: () => undefined,
    sendText: () => undefined,
    setTyping: () => undefined,
    phase: 'idle',
    voice: SILENT_VOICE,
    user: NOBODY,
    thinking: false,
    quietFor: () => true,
    dispose: () => undefined,
  };
}

// ─────────────────────────── the hologram (src/hologram3d/) ───────────────────────────

/** What drives him each frame. */
export interface HologramDrive {
  voice: JarvisVoice;
  user?: UserVoice;
  thinking: boolean;
  leaving: boolean;
}

export interface HologramPort {
  /** Added to the room's scene; the room positions it, and it turns itself to the viewer. */
  readonly object: Object3D;
  /** Restarts the arrival: called on every summon, including one that cancels a leaving. */
  arrive(): void;
  /** Once per frame before the room is drawn, against this frame's centre eye. */
  update(deltaSeconds: number, drive: HologramDrive, centreEye: PoseLike): void;
  /** 0–1; 0 once he has gone after `leaving`. */
  readonly presence: number;
  radius: number;
  readonly diagnostics?: { cpuMilliseconds: number; density: number; canvasKitMilliseconds: number };
  dispose(): void;
}

export type HologramFactory = (renderer: WebGLRenderer) => Promise<HologramPort>;

// ─────────────────────────── placement (src/room/) ───────────────────────────

export interface PlacementRequestLike {
  head: Vector3Like;
  /** Unit forward of the gaze, or of the controller ray that summoned him. */
  forward: Vector3Like;
  depthProbes: DepthProbe[];
  previous?: Vector3Like;
  /**
   * Which way the head is turned — beyond the contract's request, for a stand-in that needs the
   * top of the head to find "ahead" when the gaze is straight up or down.
   */
  headOrientation: QuaternionLike;
}

export interface PlacementLike {
  position: Vector3Like;
  radius: number;
  level: string;
  clearance: number;
  needsPointer: boolean;
}

export interface PlacementPort {
  place(request: PlacementRequestLike): PlacementLike | Promise<PlacementLike>;
  /**
   * Called every frame, so a room model can take its snapshot of the planes and meshes: they can
   * only be read from an active frame, and the reference space's epoch says when every cached
   * pose went stale.
   */
  observe?(frame: XRFrame, referenceSpace: XRReferenceSpace, epoch: number): void;
  /** For the HUD. */
  describe?(): { planes: number; meshes: number; labels: Record<string, number>; triangles: number };
  dispose?(): void;
}
