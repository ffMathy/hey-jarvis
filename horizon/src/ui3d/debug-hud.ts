import type { Object3D } from 'three';
import type { PoseLike } from '../xr/ray';
import { createTextPanel } from './text-panel';

/**
 * What only a real headset can say, said inside the room: `?debug`'s heads-up display.
 *
 * An immersive session has no DOM and no console the wearer can see, and the things most likely to
 * go wrong on a Quest — whether the microphone survives the session, whether the wake engine keeps
 * up, what the room data really looks like, which frame rates there are — are invisible without
 * something like this. It is a panel of plain lines, head-locked below and to the left of the view,
 * fed by whatever parts of the app have something to report; a part that is not there yet simply
 * has no line.
 */

export interface Diagnostics {
  /** The app's scene, as `app-state.ts` names it. */
  scene?: string;
  xrVisibility?: string;
  documentVisibility?: string;
  audioContext?: string;
  microphonePermission?: string;
  /** The wake stream's track: `live`, `ended`, `muted`. */
  microphoneTrack?: string;
  wake?: {
    state: string;
    level: number;
    score: number;
    chunksPerSecond: number;
    millisecondsPerChunk: number;
    armed: boolean;
  };
  conversation?: {
    phase: string;
    status?: string;
    mode?: string;
    interruptions?: number;
    halfDuplex?: boolean;
    vadScore?: number;
  };
  room?: {
    planes: number;
    meshes: number;
    labels: Record<string, number>;
    triangles: number;
    placement?: string;
  };
  frameRates?: { supported: readonly number[]; requested?: number; measured?: number };
  /** Milliseconds between the last two frames. */
  frameMilliseconds?: number;
  hologram?: { cpuMilliseconds: number; density: number; canvasKitMilliseconds: number };
  webglExtensions?: readonly string[];
}

function fixed(value: number, digits: number): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '–';
}

function describeLabels(labels: Record<string, number>): string {
  const entries = Object.entries(labels).sort(([, first], [, second]) => second - first);
  return entries.length === 0
    ? 'no labels'
    : entries.map(([label, count]) => `${label || '(none)'} ${count}`).join(', ');
}

function wakeLines(wake: NonNullable<Diagnostics['wake']>): string[] {
  return [
    `wake ${wake.state}${wake.armed ? ' armed' : ''}  score ${fixed(wake.score, 2)}  rms ${fixed(wake.level, 3)}`,
    `wake ${fixed(wake.chunksPerSecond, 1)} chunks/s  ${fixed(wake.millisecondsPerChunk, 1)} ms/chunk`,
  ];
}

function conversationLines(conversation: NonNullable<Diagnostics['conversation']>): string[] {
  const parts = [`call ${conversation.phase}`];
  if (conversation.status !== undefined) parts.push(`sdk ${conversation.status}/${conversation.mode ?? '–'}`);
  if (conversation.interruptions !== undefined) parts.push(`interruptions ${conversation.interruptions}`);
  if (conversation.halfDuplex) parts.push('half-duplex');
  if (conversation.vadScore !== undefined) parts.push(`vad ${fixed(conversation.vadScore, 2)}`);
  return [parts.join('  ')];
}

function roomLines(room: NonNullable<Diagnostics['room']>): string[] {
  const lines = [
    `room ${room.planes} planes  ${room.meshes} meshes  ${room.triangles} triangles`,
    `labels ${describeLabels(room.labels)}`,
  ];
  if (room.placement !== undefined) lines.push(`placed ${room.placement}`);
  return lines;
}

function frameLine(diagnostics: Diagnostics): string | undefined {
  const { frameRates, frameMilliseconds } = diagnostics;
  if (frameRates === undefined && frameMilliseconds === undefined) return undefined;
  const parts: string[] = [];
  if (frameRates !== undefined) {
    parts.push(`rates ${frameRates.supported.length > 0 ? frameRates.supported.join('/') : 'fixed'}`);
    if (frameRates.requested !== undefined) parts.push(`asked ${frameRates.requested}`);
    if (frameRates.measured !== undefined) parts.push(`got ${fixed(frameRates.measured, 0)}`);
  }
  if (frameMilliseconds !== undefined) parts.push(`frame ${fixed(frameMilliseconds, 1)} ms`);
  return parts.join('  ');
}

function visibilityLine(diagnostics: Diagnostics): string | undefined {
  const parts = [
    diagnostics.xrVisibility === undefined ? undefined : `xr ${diagnostics.xrVisibility}`,
    diagnostics.documentVisibility === undefined ? undefined : `page ${diagnostics.documentVisibility}`,
    diagnostics.audioContext === undefined ? undefined : `audio ${diagnostics.audioContext}`,
  ].filter((part) => part !== undefined);
  return parts.length > 0 ? parts.join('  ') : undefined;
}

function microphoneLine(diagnostics: Diagnostics): string | undefined {
  if (diagnostics.microphonePermission === undefined && diagnostics.microphoneTrack === undefined) return undefined;
  return `mic ${diagnostics.microphonePermission ?? '–'}  track ${diagnostics.microphoneTrack ?? '–'}`;
}

function hologramLine(hologram: NonNullable<Diagnostics['hologram']>): string {
  const { cpuMilliseconds, canvasKitMilliseconds, density } = hologram;
  return `hologram cpu ${fixed(cpuMilliseconds, 1)} ms  skia ${fixed(canvasKitMilliseconds, 1)} ms  density ${fixed(density, 2)}`;
}

function extensionsLine(extensions: readonly string[]): string {
  return `gl ${extensions.length > 0 ? extensions.join(' ') : 'none of interest'}`;
}

/** Everything known, as short lines; parts with nothing to report are left out. */
export function describeDiagnostics(diagnostics: Diagnostics): string[] {
  const { scene, wake, conversation, room, hologram, webglExtensions } = diagnostics;
  return [
    scene === undefined ? undefined : `scene ${scene}`,
    visibilityLine(diagnostics),
    microphoneLine(diagnostics),
    ...(wake === undefined ? [] : wakeLines(wake)),
    ...(conversation === undefined ? [] : conversationLines(conversation)),
    ...(room === undefined ? [] : roomLines(room)),
    frameLine(diagnostics),
    hologram === undefined ? undefined : hologramLine(hologram),
    webglExtensions === undefined ? undefined : extensionsLine(webglExtensions),
  ].filter((line) => line !== undefined);
}

/**
 * The WebGL extensions whose presence changes what the hologram can do on a headset: multiview,
 * float render targets, and the debug renderer name that says which GPU this is.
 */
export const EXTENSIONS_OF_INTEREST = [
  'OCULUS_multiview',
  'OVR_multiview2',
  'EXT_color_buffer_float',
  'EXT_color_buffer_half_float',
  'EXT_float_blend',
  'OES_texture_float_linear',
  'WEBGL_debug_renderer_info',
] as const;

/** Which of {@link EXTENSIONS_OF_INTEREST} a context has. */
export function extensionsOfInterest(supported: readonly string[] | null): string[] {
  const available = new Set(supported ?? []);
  return EXTENSIONS_OF_INTEREST.filter((name) => available.has(name));
}

export interface DebugHud {
  readonly object: Object3D;
  update(diagnostics: Diagnostics): void;
  /** Keeps it below and to the left of the view. Call every frame. */
  follow(eye: PoseLike): void;
  dispose(): void;
}

/** Where the HUD sits in the view: ahead, down and to the left, clear of where he usually stands. */
const HUD_OFFSET = { x: -0.28, y: -0.26, z: -0.75 };

export function createDebugHud(): DebugHud {
  const panel = createTextPanel({ widthMetres: 0.42, tone: 'hud' });
  return {
    object: panel.object,
    update(diagnostics) {
      panel.setText(describeDiagnostics(diagnostics));
    },
    follow(eye) {
      const { x, y, z, w } = eye.orientation;
      panel.object.quaternion.set(x, y, z, w);
      panel.object.position.set(HUD_OFFSET.x, HUD_OFFSET.y, HUD_OFFSET.z).applyQuaternion(panel.object.quaternion);
      panel.object.position.add(eye.position);
    },
    dispose() {
      panel.dispose();
    },
  };
}
