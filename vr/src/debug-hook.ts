import type { AppView } from './app/app-state';

/**
 * What the app shows the browser tests through `window.__jarvis`.
 *
 * The room is a WebGL canvas, so there is nothing in the DOM a test can read to see whether
 * Jarvis is where he should be or is still being drawn. This is that window: a plain object
 * the app keeps current and a Playwright spec reads with `page.evaluate`. It is on in every
 * build, because it costs one assignment a frame and the published site is exactly what the
 * e2e suite exercises; nothing reads it but the tests.
 */

/** Where the app is: on the 2D page, getting into the room, or in it. */
export type JarvisPhase = 'loading' | 'unsupported' | 'ready' | 'entering' | 'in-room' | 'failed';

/** A point in the session's `local-floor` space, in metres. */
export interface RoomPoint {
  x: number;
  y: number;
  z: number;
}

/** How the last placement went: how far the rules had to relax, and how much room he was given. */
export interface PlacementReport {
  /** `full`, `tight`, `small`, `wide` or `fallback`: see `src/room/types.ts`. */
  level: string;
  /** Free distance around his centre, in metres; Infinity when nothing about the room was known. */
  clearance: number;
  radius: number;
  needsPointer: boolean;
}

/**
 * What the room's state machine thinks is going on: the scene, what each panel says, whether the
 * wake word is armed, and the effects of the last few steps — which is what a test driving selects
 * and the wake word needs to see.
 */
export interface RoomReport {
  /** The scene, as the room spells it: `waiting`, `present:live`, `sample:thinking`, `leaving:wait`… */
  scene: string;
  view: AppView;
  /**
   * The effects carried out recently, oldest first, each as its type and — for the ones about a
   * panel or a mood — what it was about: `hang-up`, `show-panel toast: Listening`, `cycle-sample idle`.
   * A panel that is only up for a moment may be gone by the time a test looks at the view; its
   * effect is still here.
   */
  recentEffects: string[];
}

/** Where his voice comes from (see `conversation/voice-route.ts`), and where it was last put. */
export interface VoiceReport {
  /** `spatial`, from where he stands, or `element`, from the headset. */
  route: string;
  /** The route, or `half-duplex` once the session mutes the microphone while he speaks on the element. */
  tier: string;
  /** Why, as `voice-route.ts` names it: `platform-echo-canceller`, `setting-off`, `echo-transcript`… */
  reason: string;
  /** What the wake word's microphone said about the echo canceller: `platform`, `browser` or `unknown`. */
  echoCanceller: string;
  /** The page's "His voice from where he stands". */
  setting: boolean;
  /** Whether `?voice=spatial` asked for it whatever the microphone said. */
  forced: boolean;
  /** How the greeting is heard: from its own element, through the panner, or centred through Web Audio. */
  greeting: 'element' | 'spatial' | 'dry';
  /** Where the listener was last put — the centre eye — or null before his voice was ever placed. */
  listener: RoomPoint | null;
  /** Where the panner was last put — his centre — or null before his voice was ever placed. */
  speaker: RoomPoint | null;
}

/** A ray in the session's space: where it starts, and its unit direction. */
export interface RayReport {
  origin: RoomPoint;
  direction: RoomPoint;
}

/** One hand or controller as placing things reads it — for the tests to aim with. */
export interface EntityInputReport {
  /** `left-hand`, `right-controller`… */
  id: string;
  kind: string;
  pinching: boolean;
  pointing: boolean;
  wristRaised: boolean;
  /** Where it holds things: a hand's pinch point, a controller's grip. */
  grip: RoomPoint | null;
  /** A hand's index tip, which presses buttons. */
  indexTip: RoomPoint | null;
  /** Its target ray: a controller's laser, a hand's system ray. */
  ray: RayReport | null;
  /** A pointing hand's index finger. */
  fingerRay: RayReport | null;
}

/** The things Jarvis works on, placed in the room (`app/room-entities.ts`, `src/entities/`). */
export interface EntitiesReport {
  /** Every entity ever marked, by id, in the drawer's order. */
  known: string[];
  /** The placed ones: the anchor each is kept on, and where it is now — null while its anchor is not located. */
  placed: { id: string; anchor: string; position: RoomPoint | null }[];
  /** The entities with a corona lit, lighting or fading. */
  affected: string[];
  /** The coronas drawn in the last frame, and where. */
  coronas: { id: string; level: number; position: RoomPoint }[];
  /** What sir is pointing at, by id. */
  pointed: string | null;
  /**
   * What the conversation would be told about it the moment the call is live — offline, in the
   * browser tests, the call never is.
   */
  pendingContext: string | null;
  /** The drawer, and the entities on the page it shows, each with where its token floats. */
  drawer: {
    open: boolean;
    page: number;
    slots: { id: string; label: string; state: string; worldPosition: RoomPoint }[];
    /** The buttons it has — Done, and the page buttons when there are pages — and where each is. */
    buttons: { button: string; worldPosition: RoomPoint }[];
  };
  /** The tokens in a hand, and where each would go if let go now. */
  carried: { id: string; grabber: string; mode: string; over: string; position: RoomPoint }[];
  inputs: EntityInputReport[];
  /** Where the wrist button stands, while a wrist is raised. */
  wristButton: RoomPoint | null;
  /** The room anchors: each stored one's state this session, those not found, drops waiting on a new one. */
  anchors: { states: Record<string, string>; notFound: string[]; pending: number };
  /** What the drawer's message line says. */
  message: string | null;
  /** Why the registry could not be written, when it could not. */
  writeProblem: string | null;
}

export interface JarvisDebugState {
  phase: JarvisPhase;
  /** Frames drawn in the room since the session started. */
  frames: number;
  /** Where the centre of the hologram is, once he has been placed. */
  hologramPosition: RoomPoint | null;
  /** Where the viewer's head was when he was placed. */
  headPositionAtPlacement: RoomPoint | null;
  placement: PlacementReport | null;
  /** How many times the wake word has fired in a room since the page opened. */
  wakes: number;
  /** The room's state machine, once a room has been opened. */
  room: RoomReport | null;
  /** The last thing that went wrong, as shown on the page. */
  problem: string | null;
  /** Where his voice comes from, once a conversation room has been opened. */
  voice: VoiceReport | null;
  /** The things he works on, placed in the room, once a room has been opened. */
  entities: EntitiesReport | null;
}

declare global {
  interface Window {
    __jarvis?: JarvisDebugState;
  }
}

/** The state the page starts in, before anything has been checked. */
export function initialDebugState(): JarvisDebugState {
  return {
    phase: 'loading',
    frames: 0,
    hologramPosition: null,
    headPositionAtPlacement: null,
    placement: null,
    wakes: 0,
    room: null,
    problem: null,
    voice: null,
    entities: null,
  };
}

/** A plain copy of `point`, so the hook holds data rather than a live three.js vector. */
export function toRoomPoint(point: RoomPoint): RoomPoint {
  return { x: point.x, y: point.y, z: point.z };
}

/** Publishes `state` as `window.__jarvis`, and returns it so the caller keeps writing to the same object. */
export function publishDebugState(state: JarvisDebugState): JarvisDebugState {
  window.__jarvis = state;
  return state;
}
