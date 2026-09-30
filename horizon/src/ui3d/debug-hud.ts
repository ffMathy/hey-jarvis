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
    /** Why it is not listening, as the status line says it. */
    problem?: string;
    /** Whether it is waiting for a select to get audio going again. */
    needsGesture?: boolean;
  };
  /** The wake engine's own audio: its 16 kHz context, and what it has had to put up with. */
  wakeAudio?: {
    contextState?: string;
    sampleRate?: number;
    droppedChunks: number;
    recoveries: number;
    profile: string;
  };
  conversation?: {
    phase: string;
    status?: string;
    mode?: string;
    interruptions?: number;
    halfDuplex?: boolean;
    vadScore?: number;
    /** The last error the SDK reported without ending the conversation. */
    lastError?: string;
  };
  /** Where his voice comes from (`conversation/voice-route.ts`). */
  voice?: {
    /** `spatial`, `element` or `half-duplex`: the route, with the session's fallback on top. */
    tier: string;
    /** Why, in words. */
    reason: string;
    /** What the wake word's microphone said about the echo canceller. */
    echoCanceller: string;
    /** The SDK's `<audio>` elements, and the volume they are kept at. */
    elements: number;
    elementVolume: number;
  };
  room?: {
    planes: number;
    meshes: number;
    labels: Record<string, number>;
    triangles: number;
    /** Occupied cells in the placement grid. */
    voxels?: number;
    /** Why the room could not be used. */
    problem?: string;
    placement?: string;
  };
  /** The session features the headset granted, of those the room asked for. */
  xrFeatures?: readonly string[];
  frameRates?: { supported: readonly number[]; requested?: number; measured?: number };
  /** Milliseconds between the last two frames. */
  frameMilliseconds?: number;
  /** `surface` is where CanvasKit draws: `webgl` or `cpu`. */
  hologram?: { cpuMilliseconds: number; density: number; canvasKitMilliseconds: number; surface?: string };
  /** The things he works on, placed in the room (`app/room-entities.ts`). */
  entities?: {
    known: number;
    placed: number;
    /** Placed ones whose anchor is located this frame: the ones in this room. */
    here: number;
    anchorsLocated: number;
    anchors: number;
    /** What sir is pointing at, by name. */
    pointed?: string;
    lit: number;
    /** Why the registry could not be written. */
    problem?: string;
  };
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
  const lines = [
    `wake ${wake.state}${wake.armed ? ' armed' : ''}  score ${fixed(wake.score, 2)}  rms ${fixed(wake.level, 3)}`,
    `wake ${fixed(wake.chunksPerSecond, 1)} chunks/s  ${fixed(wake.millisecondsPerChunk, 1)} ms/chunk`,
  ];
  if (wake.problem !== undefined) lines.push(`wake: ${wake.problem}${wake.needsGesture ? ' (needs a select)' : ''}`);
  return lines;
}

function wakeAudioLine(audio: NonNullable<Diagnostics['wakeAudio']>): string {
  const rate = audio.sampleRate === undefined ? '–' : `${audio.sampleRate} Hz`;
  return (
    `wake audio ${audio.contextState ?? '–'} ${rate}  ${audio.profile}  ` +
    `dropped ${audio.droppedChunks}  recoveries ${audio.recoveries}`
  );
}

function conversationLines(conversation: NonNullable<Diagnostics['conversation']>): string[] {
  const parts = [`call ${conversation.phase}`];
  if (conversation.status !== undefined) parts.push(`sdk ${conversation.status}/${conversation.mode ?? '–'}`);
  if (conversation.interruptions !== undefined) parts.push(`interruptions ${conversation.interruptions}`);
  if (conversation.halfDuplex) parts.push('half-duplex');
  if (conversation.vadScore !== undefined) parts.push(`vad ${fixed(conversation.vadScore, 2)}`);
  const lines = [parts.join('  ')];
  if (conversation.lastError !== undefined) lines.push(`call error: ${conversation.lastError}`);
  return lines;
}

/**
 * The voice's tier on one line: spatial, element, or half-duplex — the element with the session's
 * fallback on top, which the conversation line also shows.
 */
function voiceLine(voice: NonNullable<Diagnostics['voice']>): string {
  const elements = voice.elements === 1 ? 'element' : 'elements';
  return (
    `voice ${voice.tier} (${voice.reason})  echo canceller ${voice.echoCanceller}  ` +
    `${voice.elements} sdk ${elements} at volume ${fixed(voice.elementVolume, 0)}`
  );
}

function roomLines(room: NonNullable<Diagnostics['room']>): string[] {
  const voxels = room.voxels === undefined ? '' : `  ${room.voxels} voxels`;
  const lines = [
    `room ${room.planes} planes  ${room.meshes} meshes  ${room.triangles} triangles${voxels}`,
    `labels ${describeLabels(room.labels)}`,
  ];
  if (room.problem !== undefined) lines.push(`room: ${room.problem}`);
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
  const { cpuMilliseconds, canvasKitMilliseconds, density, surface } = hologram;
  const skia = `skia ${fixed(canvasKitMilliseconds, 1)} ms${surface === undefined ? '' : ` ${surface}`}`;
  return `hologram cpu ${fixed(cpuMilliseconds, 1)} ms  ${skia}  density ${fixed(density, 2)}`;
}

function entitiesLine(entities: NonNullable<Diagnostics['entities']>): string {
  const parts = [
    `entities ${entities.known} known`,
    `${entities.placed} placed, ${entities.here} here`,
    `anchors ${entities.anchorsLocated}/${entities.anchors} located`,
    `lit ${entities.lit}`,
  ];
  if (entities.pointed !== undefined) parts.push(`pointing at ${entities.pointed}`);
  if (entities.problem !== undefined) parts.push(entities.problem);
  return parts.join('  ');
}

function extensionsLine(extensions: readonly string[]): string {
  return `gl ${extensions.length > 0 ? extensions.join(' ') : 'none of interest'}`;
}

function featuresLine(features: readonly string[]): string {
  return `xr ${features.length > 0 ? features.join(' ') : 'no features'}`;
}

/** Everything known, as short lines; parts with nothing to report are left out. */
export function describeDiagnostics(diagnostics: Diagnostics): string[] {
  const { scene, wake, wakeAudio, conversation, voice, room, hologram, entities, webglExtensions, xrFeatures } =
    diagnostics;
  return [
    scene === undefined ? undefined : `scene ${scene}`,
    visibilityLine(diagnostics),
    microphoneLine(diagnostics),
    ...(wake === undefined ? [] : wakeLines(wake)),
    wakeAudio === undefined ? undefined : wakeAudioLine(wakeAudio),
    ...(conversation === undefined ? [] : conversationLines(conversation)),
    voice === undefined ? undefined : voiceLine(voice),
    ...(room === undefined ? [] : roomLines(room)),
    entities === undefined ? undefined : entitiesLine(entities),
    frameLine(diagnostics),
    hologram === undefined ? undefined : hologramLine(hologram),
    xrFeatures === undefined ? undefined : featuresLine(xrFeatures),
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
