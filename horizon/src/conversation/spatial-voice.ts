import type { ConversationMessage, GreetingPlayer } from 'hologram';
import type { VoiceReport } from '../debug-hook';
import { type PoseLike, rotate, type Vector3Like } from '../xr/ray';
import { type AgentElementVolume, createAgentElementVolume, pageElementSources } from './agent-element-volume';
import type { EchoCanceller } from './echo-canceller';
import {
  createVoiceRouter,
  describeVoiceRouteReason,
  type VoiceDemotion,
  type VoiceRoute,
  type VoiceRouteChoice,
} from './voice-route';
import { createVoiceWatch } from './voice-watch';

/**
 * His voice from where he stands: a panner at his centre, and the listener at the head.
 *
 * When `voice-route.ts` says the headset can take it, his voice — the recorded greeting, and then
 * his track in the call — is played through Web Audio instead of from the headset:
 *
 *     his track ─► MediaStreamSource ─┬─► analyser (the sphere follows it: agent-room.ts)
 *                                     └─► gain ─┬─► panner (HRTF, at his centre) ─► master ─► speakers
 *                                               └─► level (the echo and silence watch)
 *     greeting <audio> ─► MediaElementSource ─┬─► gain ─► the same panner
 *                                             └─► gain (dry, once he is back on the headset) ─► master
 *
 * The listener is moved to the centre eye, facing where it faces, every XR frame, and the panner to
 * his anchor. The SDK's own `<audio>` element keeps playing him at volume 0 while his track goes
 * through the panner (`agent-element-volume.ts` says why it must keep playing, and why volume).
 *
 * **Nothing is built until it is needed.** On a headset whose route is the element from the start —
 * no platform echo canceller, or the setting off — no node is made, the greeting is never taken
 * into Web Audio, and the page does exactly what it did before this file existed.
 *
 * **Moving back to the headset** (`demote`) restores the element's volume, fades the spatial branch
 * out over a few tens of milliseconds and disconnects it once it is silent; the analyser the sphere
 * follows is untouched. A greeting already taken into Web Audio can never be given back to its
 * element — `createMediaElementSource` is once per element for good — so from then on it plays
 * through the dry branch, centred, as it would have from the element; and if the AudioContext is
 * not running when it is due, it is reported refused, so the agent says its own first line instead
 * of him greeting in silence.
 */

// ─────────────────────────── as much of Web Audio as this uses ───────────────────────────

/** An `AudioParam`, as far as moving a voice or fading one takes. */
export interface MovableParam {
  value: number;
  setValueAtTime(value: number, startTime: number): unknown;
  setTargetAtTime(target: number, startTime: number, timeConstant: number): unknown;
  cancelScheduledValues(cancelTime: number): unknown;
}

/** An `AudioNode`, as far as wiring one takes. */
export interface SoundNode {
  connect(destination: SoundNode): unknown;
  disconnect(destination: SoundNode): unknown;
}

export interface GainLike extends SoundNode {
  readonly gain: MovableParam;
}

export interface PannerLike extends SoundNode {
  panningModel: string;
  distanceModel: string;
  refDistance: number;
  maxDistance: number;
  rolloffFactor: number;
  readonly positionX: MovableParam;
  readonly positionY: MovableParam;
  readonly positionZ: MovableParam;
}

export interface LevelLike extends SoundNode {
  fftSize: number;
  getFloatTimeDomainData(array: Float32Array<ArrayBuffer>): void;
}

export interface ListenerLike {
  readonly positionX: MovableParam;
  readonly positionY: MovableParam;
  readonly positionZ: MovableParam;
  readonly forwardX: MovableParam;
  readonly forwardY: MovableParam;
  readonly forwardZ: MovableParam;
  readonly upX: MovableParam;
  readonly upY: MovableParam;
  readonly upZ: MovableParam;
}

/** The app's `AudioContext`, as far as placing his voice takes. */
export interface SpatialAudioContext {
  readonly state: string;
  readonly currentTime: number;
  readonly destination: SoundNode;
  readonly listener: ListenerLike;
  createGain(): GainLike;
  createPanner(): PannerLike;
  createAnalyser(): LevelLike;
}

/**
 * Whether a context has what placing his voice takes: a panner, a listener whose position is an
 * `AudioParam`, and a way to take the greeting's element in. Every Quest Browser has; older engines
 * had only the listener's deprecated `setPosition`.
 */
export function hasSpatialAudio(context: object): boolean {
  const listener: unknown = Reflect.get(context, 'listener');
  return (
    typeof Reflect.get(context, 'createPanner') === 'function' &&
    typeof Reflect.get(context, 'createMediaElementSource') === 'function' &&
    typeof listener === 'object' &&
    listener !== null &&
    Reflect.get(listener, 'positionX') !== undefined
  );
}

// ─────────────────────────── how he sounds ───────────────────────────

/**
 * How his voice falls off with distance: not at all within a metre, then gently (`inverse`, half
 * the usual rolloff), so at 1.6 m, where he usually stands, he is at about three quarters of the
 * level the headset played him at, and at the far edge of placement (2.6 m) a little over half. A
 * room is 0.5 to 3 metres across; the full rolloff would make him too quiet at the back of it.
 */
export const REFERENCE_DISTANCE_METRES = 1;
export const ROLLOFF = 0.5;
export const MAXIMUM_DISTANCE_METRES = 10;

/**
 * How quickly the listener and the panner follow the head and his anchor, as a time constant.
 * Short enough not to be heard as lag, long enough that a frame's step is not a click — and the
 * research suggests smoothing helps an echo canceller cope with the stereo image moving.
 */
export const FOLLOW_SECONDS = 0.03;

/** A step longer than this in one frame is a new place, and is jumped to rather than glided to. */
export const JUMP_METRES = 0.5;

/** How quickly the spatial branch fades out when his voice moves to the headset. */
export const FADE_SECONDS = 0.01;

/** How long after that fade the branch is disconnected: several time constants, so it is silent. */
export const DISCONNECT_AFTER_MS = 100;

/** About 20 ms at 48 kHz: the window the echo and silence watch reads his level over. */
export const LEVEL_WINDOW = 1024;

// ─────────────────────────── the voice itself ───────────────────────────

/** What the HUD shows about his voice. */
export interface VoiceDiagnostics {
  route: VoiceRoute;
  /** Why, in words. */
  reason: string;
  echoCanceller: EchoCanceller;
  /** How many of the SDK's elements there are, at whatever volume the route gives them. */
  elements: number;
  elementVolume: number;
}

export interface SpatialVoice {
  /** Chooses the route for a room about to open. A demotion already seen on this page still stands. */
  choose(choice: VoiceRouteChoice): void;
  /** Every XR frame: the head, and where he stands — undefined while he is not there. */
  follow(listener: PoseLike, speaker: Vector3Like | undefined): void;
  /** What `window.__jarvis.voice` shows; the same object, kept current. */
  readonly report: VoiceReport;
  diagnostics(): VoiceDiagnostics;
  /** The greeting's player, routed: through the panner while he is spatial. */
  greeting(player: GreetingPlayer): GreetingPlayer;
  /** His track's source node, to be played from where he stands; returns how to let go of it. */
  playAgent(source: SoundNode): () => void;
  /**
   * A conversation's room has been found: nothing is held against it yet, and `serverSaysSpeaking`
   * is LiveKit's word on whether he is talking, until the returned function is called.
   */
  conversationOpened(serverSaysSpeaking: () => boolean): () => void;
  /** An element LiveKit has attached his track to. */
  attached(element: unknown): void;
  /** One of his interruptions, after the session has dealt with it. */
  interrupted(): void;
  /** A line of the conversation, either side's. */
  heard(message: ConversationMessage): void;
  /** Whether the session's half-duplex fallback may judge an interruption now (see `voice-route.ts`). */
  halfDuplexMayJudge(): boolean;
  dispose(): void;
}

export interface SpatialVoiceOptions {
  context: SpatialAudioContext;
  /**
   * Takes the greeting's element into the context. `createMediaElementSource` can only ever be
   * called once for an element, and from then on the element is heard only through the context, so
   * it is asked for only when he first greets from where he stands.
   */
  captureGreeting: () => SoundNode;
  elements: AgentElementVolume;
  now: () => number;
  choice: VoiceRouteChoice;
}

interface Graph {
  master: GainLike;
  panner: PannerLike;
  agent: GainLike;
  level: LevelLike;
}

interface GreetingBranches {
  panned: GainLike;
  dry: GainLike;
}

function copyInto(target: Vector3Like | null, source: Vector3Like): Vector3Like {
  if (target === null) return { x: source.x, y: source.y, z: source.z };
  target.x = source.x;
  target.y = source.y;
  target.z = source.z;
  return target;
}

function distance(one: Vector3Like, other: Vector3Like): number {
  return Math.hypot(one.x - other.x, one.y - other.y, one.z - other.z);
}

const FORWARD = { x: 0, y: 0, z: -1 };
const UP = { x: 0, y: 1, z: 0 };

export function createSpatialVoice(options: SpatialVoiceOptions): SpatialVoice {
  const { context, captureGreeting, elements, now } = options;
  const router = createVoiceRouter(now, options.choice);
  const watch = createVoiceWatch(now);
  let choice = options.choice;
  let graph: Graph | undefined;
  let greetingBranches: GreetingBranches | undefined;
  let greetingUncapturable = false;
  let agentSource: SoundNode | undefined;
  let serverSaysSpeaking = () => false;
  let listenerPlaced = false;
  let speakerPlacedAt: Vector3Like | undefined;
  let lastSpeaker: Vector3Like | undefined;
  let disconnectAgentAt: number | undefined;
  const samples = new Float32Array(LEVEL_WINDOW);

  const report: VoiceReport = {
    route: router.route,
    reason: router.reason,
    echoCanceller: choice.echoCanceller,
    setting: choice.setting,
    forced: choice.forced,
    greeting: 'element',
    listener: null,
    speaker: null,
  };

  /** How the greeting is heard now: from its own element until it is taken in, then by the route. */
  const greetingRoute = (): VoiceReport['greeting'] => {
    if (greetingBranches === undefined) return 'element';
    return router.route === 'spatial' ? 'spatial' : 'dry';
  };

  const refreshReport = () => {
    report.route = router.route;
    report.reason = router.reason;
    report.echoCanceller = choice.echoCanceller;
    report.setting = choice.setting;
    report.forced = choice.forced;
    report.greeting = greetingRoute();
  };

  const setGain = (node: GainLike, value: number, timeConstant?: number) => {
    const time = context.currentTime;
    node.gain.cancelScheduledValues(time);
    if (timeConstant === undefined) node.gain.setValueAtTime(value, time);
    else node.gain.setTargetAtTime(value, time, timeConstant);
  };

  const move = (param: MovableParam, value: number, jump: boolean) => {
    const time = context.currentTime;
    if (jump) {
      param.cancelScheduledValues(time);
      param.setValueAtTime(value, time);
    } else {
      param.setTargetAtTime(value, time, FOLLOW_SECONDS);
    }
  };

  const placeSpeaker = (panner: PannerLike, speaker: Vector3Like) => {
    const jump = speakerPlacedAt === undefined || distance(speakerPlacedAt, speaker) > JUMP_METRES;
    move(panner.positionX, speaker.x, jump);
    move(panner.positionY, speaker.y, jump);
    move(panner.positionZ, speaker.z, jump);
    speakerPlacedAt = copyInto(speakerPlacedAt ?? null, speaker);
    report.speaker = copyInto(report.speaker, speaker);
  };

  const placeListener = (pose: PoseLike) => {
    const { listener } = context;
    const jump = !listenerPlaced;
    const forward = rotate(FORWARD, pose.orientation);
    const up = rotate(UP, pose.orientation);
    move(listener.positionX, pose.position.x, jump);
    move(listener.positionY, pose.position.y, jump);
    move(listener.positionZ, pose.position.z, jump);
    move(listener.forwardX, forward.x, jump);
    move(listener.forwardY, forward.y, jump);
    move(listener.forwardZ, forward.z, jump);
    move(listener.upX, up.x, jump);
    move(listener.upY, up.y, jump);
    move(listener.upZ, up.z, jump);
    listenerPlaced = true;
    report.listener = copyInto(report.listener, pose.position);
  };

  const ensureGraph = (): Graph => {
    if (graph !== undefined) return graph;
    const master = context.createGain();
    master.connect(context.destination);
    const panner = context.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = REFERENCE_DISTANCE_METRES;
    panner.rolloffFactor = ROLLOFF;
    panner.maxDistance = MAXIMUM_DISTANCE_METRES;
    panner.connect(master);
    const agent = context.createGain();
    agent.gain.value = 0;
    agent.connect(panner);
    const level = context.createAnalyser();
    level.fftSize = LEVEL_WINDOW;
    agent.connect(level);
    graph = { master, panner, agent, level };
    // Where he already stands, so his first word is not heard from the floor under the origin.
    if (lastSpeaker !== undefined) placeSpeaker(panner, lastSpeaker);
    return graph;
  };

  const captureGreetingBranches = (built: Graph): GreetingBranches | undefined => {
    if (greetingBranches !== undefined || greetingUncapturable) return greetingBranches;
    let source: SoundNode;
    try {
      source = captureGreeting();
    } catch {
      // Taken already, or not the page's to take: it goes on playing from its element, centred.
      greetingUncapturable = true;
      return undefined;
    }
    const panned = context.createGain();
    panned.connect(built.panner);
    source.connect(panned);
    const dry = context.createGain();
    dry.gain.value = 0;
    dry.connect(built.master);
    source.connect(dry);
    greetingBranches = { panned, dry };
    return greetingBranches;
  };

  const routeGreeting = (branches: GreetingBranches, spatial: boolean, timeConstant: number | undefined) => {
    setGain(branches.panned, spatial ? 1 : 0, timeConstant);
    setGain(branches.dry, spatial ? 0 : 1, timeConstant);
  };

  /** Sets every gain and the elements' volume to what the route says now. */
  const applyRoute = (fade: boolean) => {
    const spatial = router.route === 'spatial';
    const throughPanner = spatial && agentSource !== undefined;
    const timeConstant = fade ? FADE_SECONDS : undefined;
    if (graph !== undefined) setGain(graph.agent, throughPanner ? 1 : 0, timeConstant);
    if (greetingBranches !== undefined) routeGreeting(greetingBranches, spatial, timeConstant);
    // Silent only while his track really is going through the panner: an element that plays before
    // the branch is connected is heard from the headset rather than not at all.
    elements.set(throughPanner ? 0 : 1);
    refreshReport();
  };

  const demote = (reason: VoiceDemotion) => {
    if (!router.demote(reason)) return;
    applyRoute(true);
    if (graph !== undefined) disconnectAgentAt = now() + DISCONNECT_AFTER_MS;
  };

  const levelNow = (): number | undefined => {
    if (graph === undefined || agentSource === undefined) return undefined;
    graph.level.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    return Math.sqrt(sum / samples.length);
  };

  const judge = () => {
    if (router.route !== 'spatial') return;
    const demotion = watch.sample({
      level: levelNow(),
      contextRunning: context.state === 'running',
      serverSaysSpeaking: serverSaysSpeaking(),
    });
    if (demotion !== undefined) demote(demotion);
  };

  const disconnectAgentBranchIfDue = () => {
    if (disconnectAgentAt === undefined || graph === undefined || now() < disconnectAgentAt) return;
    disconnectAgentAt = undefined;
    try {
      graph.agent.disconnect(graph.panner);
    } catch {
      // Already disconnected: there is nothing left to hear from it either way.
    }
  };

  /**
   * Gets the greeting's route ready before it plays, and says whether it can be heard at all. Only
   * a greeting already taken into Web Audio can be silent — when the context has stopped — and
   * that one is reported refused.
   */
  const readyGreeting = (): boolean => {
    const running = context.state === 'running';
    if (router.route === 'spatial') {
      if (running) {
        captureGreetingBranches(ensureGraph());
        applyRoute(false);
        return true;
      }
      demote('context-not-running');
    }
    if (greetingBranches === undefined) return true;
    if (!running) return false;
    applyRoute(false);
    return true;
  };

  return {
    choose: (next) => {
      choice = next;
      router.choose(next);
      applyRoute(false);
    },
    follow: (listener, speaker) => {
      judge();
      disconnectAgentBranchIfDue();
      if (speaker === undefined) {
        // He has gone: wherever he appears next is jumped to, not glided to from here.
        speakerPlacedAt = undefined;
      } else {
        lastSpeaker = copyInto(lastSpeaker ?? null, speaker);
      }
      if (graph === undefined || router.route !== 'spatial') return;
      placeListener(listener);
      if (speaker !== undefined) placeSpeaker(graph.panner, speaker);
    },
    report,
    diagnostics: () => ({
      route: router.route,
      reason: describeVoiceRouteReason(router.reason),
      echoCanceller: choice.echoCanceller,
      elements: elements.elements,
      elementVolume: elements.volume,
    }),
    greeting: (player) => ({
      playFromStart: async () => (readyGreeting() ? player.playFromStart() : false),
      stop: () => player.stop(),
      position: () => player.position(),
      get duration() {
        return player.duration;
      },
    }),
    playAgent: (source) => {
      if (router.route !== 'spatial') return () => undefined;
      const built = ensureGraph();
      source.connect(built.agent);
      agentSource = source;
      applyRoute(false);
      return () => {
        try {
          source.disconnect(built.agent);
        } catch {
          // Disconnected already, by a demotion or by the track going.
        }
        if (agentSource === source) {
          agentSource = undefined;
          applyRoute(false);
        }
      };
    },
    conversationOpened: (saysSpeaking) => {
      watch.reset();
      serverSaysSpeaking = saysSpeaking;
      return () => {
        if (serverSaysSpeaking === saysSpeaking) serverSaysSpeaking = () => false;
      };
    },
    attached: (element) => elements.adopt(element),
    interrupted: () => {
      const demotion = watch.interrupted();
      if (demotion !== undefined) demote(demotion);
    },
    heard: (message) => {
      if (message.role === 'user') {
        const demotion = watch.userSaid(message.message);
        if (demotion !== undefined) demote(demotion);
      } else {
        watch.agentSaid(message.message);
      }
    },
    halfDuplexMayJudge: () => router.halfDuplexMayJudge(),
    dispose: () => elements.dispose(),
  };
}

/** His voice on this page: the app's `AudioContext`, the greeting's element, the page's `<audio>`s. */
export function createPageSpatialVoice(
  context: AudioContext,
  greetingElement: HTMLMediaElement,
  choice: VoiceRouteChoice,
): SpatialVoice {
  return createSpatialVoice({
    context,
    captureGreeting: () => context.createMediaElementSource(greetingElement),
    elements: createAgentElementVolume(pageElementSources(document)),
    now: () => performance.now(),
    choice,
  });
}
