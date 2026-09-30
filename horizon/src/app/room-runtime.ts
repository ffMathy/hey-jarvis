import { describeFrameRate, PARTICLE_COUNT } from 'hologram';
import { Group } from 'three';
import { type JarvisDebugState, toRoomPoint } from '../debug-hook';
import { POINTING_CONTEXT_ID } from '../entities/pointing';
import type { KeyValueStorage } from '../page/settings';
import { createDebugHud, type DebugHud, type Diagnostics, extensionsOfInterest } from '../ui3d/debug-hud';
import { KEYBOARD_GLYPH_REACH_METRES } from '../ui3d/keyboard-glyph';
import { type AnchorKeeper, createAnchorKeeper } from '../xr/anchor-keeper';
import { createDepthProbeFan, type DepthProbeFan } from '../xr/depth-probes';
import { createInputSnapshots, type InputSnapshots } from '../xr/input-snapshots';
import type { OriginOffset } from '../xr/origin-offset';
import { type Ray, raySphereDistance, type Vector3Like } from '../xr/ray';
import { createSystemKeyboard, type SystemKeyboard } from '../xr/system-keyboard';
import { type CentreEye, gazeOf, pointAhead } from '../xr/viewer-pose';
import { createXrInput, type XrInput } from '../xr/xr-input';
import { createXrStage, type XrFrameTick, type XrStage } from '../xr/xr-stage';
import {
  type AppEffect,
  type AppEvent,
  type AppModel,
  type AppView,
  initialAppModel,
  QUIET_BEFORE_ARMING_SECONDS,
  type RoomMode,
  reduceApp,
  type SelectEvent,
  viewOf,
  type WakeReadiness,
} from './app-state';
import { createFrameRateMeter, type FrameRateMeter } from './frame-rate-meter';
import {
  type ConversationDiagnostics,
  type ConversationEvents,
  type ConversationFactory,
  type ConversationPort,
  createSilentConversation,
  type HologramFactory,
  type HologramPort,
  type PlacementLike,
  type PlacementPort,
  readinessOf,
  type VoicePort,
  type WakePort,
} from './ports';
import { publishRoomDebugState } from './room-debug-hook';
import { createRoomEntities, type RoomEntities } from './room-entities';
import { createRoomPanels, type RoomPanels } from './room-panels';
import { createSampleDriver, type SampleDriver } from './sample-driver';

/**
 * One visit to the room, from the session opening to the page coming back.
 *
 * This is where the parts meet: the XR stage and its input, the app's state machine, the hologram,
 * placement, the wake word, the conversation, and the panels. Every event from any of them is
 * turned into an `AppEvent` and put through `reduceApp`; every effect that comes back is carried
 * out here, and nowhere else decides anything. Events that arrive while effects are being carried
 * out — a conversation reporting its phase from inside `summon()`, say — wait their turn, so each
 * step sees the model the one before it left.
 *
 * The parts that are other modules' come in through `ports.ts`, and `main.ts` chooses them: the
 * wake engine, the ElevenLabs session, the 3D hologram and the room model — or, in sample mode,
 * no wake engine and no session, with the moods driving him instead.
 *
 * The things Jarvis works on — marked by the agent, placed by sir, lit while Jarvis works on them,
 * pointed at — have a controller of their own (`room-entities.ts`), which this feeds every frame
 * and whose drawer, pointing and wrist button come back here as events and context updates.
 */

export interface RoomOptions {
  mode: RoomMode;
  createHologram: HologramFactory;
  /**
   * Makes where he stands, once the room is open and drawing. The room model may start a worker,
   * and one made before the stage or the hologram failed would have nothing left to dispose it.
   */
  createPlacement: () => PlacementPort;
  /** Absent in a room that does not listen: sample mode's. */
  wake?: WakePort;
  /** Absent in a room with no ElevenLabs session to hold — sample mode's; he then stays silent. */
  createConversation?: ConversationFactory;
  /** Where his voice comes from, told where the head and he are every frame. Absent in sample mode. */
  voice?: VoicePort;
  /** Stops the microphone the wake word listened on, when the session ends. */
  stopMicrophone?: () => void;
  /** The `?debug` HUD. */
  showHud?: boolean;
  /** Sample mode's frame-rate readout, which a room opened to be filmed (`?film`) goes without. */
  showReadout?: boolean;
  /**
   * What the other modules can add to the HUD that the room cannot see itself: the microphone's
   * permission and track, the AudioContexts' states.
   */
  diagnostics?: () => Partial<Diagnostics>;
  debug: JarvisDebugState;
  /** Called once the room is open and drawing. */
  onInside?: () => void;
  now?: () => number;
  /** Where the things placed in the room are remembered: `localStorage` in the app, a map anywhere else. */
  entityStorage?: KeyValueStorage;
  /** `?origin`: the room's space moved, for the browser tests (see `xr/origin-offset.ts`). */
  origin?: OriginOffset;
}

/** What the room hands back to the page. */
export interface RoomOutcome {
  problem?: string;
}

/** How far from his centre, in radii, a select counts as being on him. */
const HIT_RADII = 1.5;

/** How often the HUD and sample mode's readout are rewritten, in milliseconds. */
const READOUT_INTERVAL_MS = 500;

/** Where he goes if placement itself fails: small, and 1.2 m ahead. */
const FALLBACK_DISTANCE_METRES = 1.2;
const FALLBACK_RADIUS_METRES = 0.13;

/**
 * Opens the room on `session` and resolves once the session has ended and everything is released.
 *
 * If the room cannot be drawn — the renderer or the hologram fails to start — the session is ended
 * at once and the failure rethrown: a session nothing is drawing in is an empty room the user would
 * have to find their own way out of.
 */
export async function runRoom(session: XRSession, options: RoomOptions): Promise<RoomOutcome> {
  let stage: XrStage | undefined;
  let hologram: HologramPort | undefined;
  try {
    stage = await createXrStage(session, { origin: options.origin });
    hologram = await options.createHologram(stage.renderer);
  } catch (error) {
    hologram?.dispose();
    stage?.dispose();
    session.end().catch(() => undefined);
    throw error;
  }
  return new Promise<RoomOutcome>((resolve) => {
    if (stage === undefined || hologram === undefined) return;
    startRoom(stage, hologram, options, resolve);
  });
}

/** The fallback spot: small, straight ahead along the floor. */
function fallbackPlacement(eye: CentreEye): PlacementLike {
  return {
    position: pointAhead(eye, FALLBACK_DISTANCE_METRES),
    radius: FALLBACK_RADIUS_METRES,
    level: 'fallback',
    clearance: Number.POSITIVE_INFINITY,
    needsPointer: false,
  };
}

/** Storage that forgets when the room closes, for a room given none to keep its placements in. */
function forgetfulStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

/** A copy that holds numbers, not whatever live vector it came from. */
function copyPoint(point: Vector3Like): Vector3Like {
  return { x: point.x, y: point.y, z: point.z };
}

function sceneName(model: AppModel): string {
  const { scene } = model;
  switch (scene.kind) {
    case 'present':
      return `present:${scene.sessionPhase}`;
    case 'sample':
      return `sample:${scene.mode}`;
    case 'leaving':
      return `leaving:${scene.afterwards}`;
    default:
      return scene.kind;
  }
}

interface Room {
  stage: XrStage;
  hologram: HologramPort;
  placement: PlacementPort;
  options: RoomOptions;
  now: () => number;
  model: AppModel;
  hologramState: AppView['hologram'];
  conversation: ConversationPort;
  conversationDiagnostics: ConversationDiagnostics | undefined;
  sample: SampleDriver;
  panels: RoomPanels;
  hud: DebugHud | undefined;
  input: XrInput;
  inputs: InputSnapshots;
  entities: RoomEntities;
  keyboard: SystemKeyboard;
  anchors: AnchorKeeper<XRSpace, XRRigidTransform>;
  depth: DepthProbeFan | undefined;
  meter: FrameRateMeter;
  holder: Group;
  spot: PlacementLike | undefined;
  pendingPlacement: { towards: Ray | undefined } | undefined;
  placing: boolean;
  pendingAnchor: Vector3Like | undefined;
  /** Whether `spot` has just been found and not yet stood at (and anchored). */
  freshSpot: boolean;
  goneReported: boolean;
  lastReadout: number;
  lastReadiness: WakeReadiness | undefined;
  /** Whether his voice was quiet when the state machine was last told, which it starts out assuming. */
  lastQuiet: boolean;
  /** Whether a drop was still settling when the state machine was last told; it starts out with none. */
  lastSettling: boolean;
  queue: AppEvent[];
  dispatching: boolean;
  /** Set by `return-to-page`: the room is let go of once the step carrying it is done. */
  returning: boolean;
  released: boolean;
  outcome: RoomOutcome;
  cleanups: (() => void)[];
  finish: () => void;
}

function startRoom(
  stage: XrStage,
  hologram: HologramPort,
  options: RoomOptions,
  resolve: (outcome: RoomOutcome) => void,
) {
  const now = options.now ?? (() => performance.now());
  // The hologram hangs from a holder the room positions, so the hologram's own object stays its to
  // turn and scale.
  const holder = new Group();
  holder.visible = false;
  holder.add(hologram.object);
  // Every canvas in the room is filtered as sharply as this GPU allows along a tilt: the drawer is a
  // lectern, and names and panels are read from the side as often as square on.
  const anisotropy = stage.renderer.capabilities.getMaxAnisotropy();
  const room: Room = {
    stage,
    hologram,
    options,
    now,
    model: initialAppModel(options.wake === undefined ? { kind: 'absent' } : readinessOf(options.wake.health)),
    hologramState: 'hidden',
    conversation: createSilentConversation(),
    conversationDiagnostics: undefined,
    sample: createSampleDriver(now),
    panels: createRoomPanels(anisotropy),
    hud: options.showHud ? createDebugHud(anisotropy) : undefined,
    input: createXrInput(stage.session, stage.referenceSpace, now),
    inputs: createInputSnapshots(stage.session),
    entities: createRoomEntities({
      session: stage.session,
      storage: options.entityStorage ?? forgetfulStorage(),
      anisotropy,
    }),
    keyboard: createSystemKeyboard(document),
    anchors: createAnchorKeeper<XRSpace, XRRigidTransform>((position) => new XRRigidTransform(position)),
    depth: undefined,
    meter: createFrameRateMeter(),
    placement: options.createPlacement(),
    holder,
    spot: undefined,
    pendingPlacement: undefined,
    placing: false,
    pendingAnchor: undefined,
    freshSpot: false,
    goneReported: false,
    lastReadout: 0,
    lastReadiness: undefined,
    lastQuiet: true,
    lastSettling: false,
    queue: [],
    dispatching: false,
    returning: false,
    released: false,
    outcome: {},
    cleanups: [],
    finish: () => undefined,
  };
  room.finish = () => {
    for (const cleanup of room.cleanups.splice(0)) cleanup();
    resolve(room.outcome);
  };

  stage.scene.add(holder, room.entities.object, ...room.panels.objects);
  if (room.hud !== undefined) stage.scene.add(room.hud.object);
  publishEntities(room);
  room.conversation = options.createConversation?.(conversationEvents(room)) ?? createSilentConversation();
  void createDepthProbeFan(stage.session).then((fan) => {
    room.depth = fan;
  });
  subscribe(room);
  options.debug.phase = 'in-room';
  options.onInside?.();
  dispatch(room, {
    type: 'entered',
    mode: options.mode,
    canType: stage.session.isSystemKeyboardSupported === true,
    readout: options.showReadout,
  });
}

/**
 * Puts the entities' report on `window.__jarvis`, worked out whenever it is read rather than every
 * frame: it is a dozen arrays, and nothing but the browser tests ever reads it.
 */
function publishEntities(room: Room) {
  Object.defineProperty(room.options.debug, 'entities', {
    get: () => room.entities.report(),
    configurable: true,
    enumerable: true,
  });
}

/** Leaves the last report on `window.__jarvis` once the room has gone, as data rather than a getter. */
function unpublishEntities(room: Room) {
  Object.defineProperty(room.options.debug, 'entities', {
    value: room.entities.report(),
    configurable: true,
    enumerable: true,
    writable: true,
  });
}

function conversationEvents(room: Room): ConversationEvents {
  return {
    onPhase: (phase) => {
      // Whatever held his coronas lit was his work for that conversation, which is over.
      if (phase === 'ended' || phase === 'failed') room.entities.conversationEnded();
      dispatch(room, { type: 'session-phase', phase });
    },
    onAffected: (entities) => room.entities.affected(entities),
    onProblem: (message) => dispatch(room, { type: 'problem', message }),
    onCaption: (text) => dispatch(room, { type: 'caption', text }),
    onDiagnostics: (diagnostics) => {
      room.conversationDiagnostics = diagnostics;
    },
  };
}

/** Everything the room listens to, each with the cleanup that stops it. */
function subscribe(room: Room) {
  const { stage, options, cleanups } = room;
  cleanups.push(stage.onFrame((tick) => onFrame(room, tick)));
  cleanups.push(stage.onVisibility((state) => dispatch(room, { type: 'visibility', state })));
  cleanups.push(room.input.onSelect((select) => onSelect(room, select.hold, select.ray)));
  cleanups.push(room.input.onDismissButton(() => dispatch(room, { type: 'dismiss-button' })));
  cleanups.push(room.input.onEditButton(() => dispatch(room, { type: 'edit-button' })));
  cleanups.push(room.keyboard.onLine((text) => dispatch(room, { type: 'typed', text })));
  cleanups.push(room.keyboard.onClose(() => dispatch(room, { type: 'keyboard-closed' })));
  const wake = options.wake;
  if (wake !== undefined) {
    cleanups.push(
      wake.onWake(() => {
        options.debug.wakes += 1;
        dispatch(room, { type: 'wake' });
      }),
    );
    cleanups.push(wake.onHealth((health) => reportReadiness(room, readinessOf(health))));
  }
  // Frames stop while hidden and may slow to a crawl while blurred; the minute's grace, the error
  // panel's time and his voice going quiet are counted all the same.
  const ticking = setInterval(() => passTime(room), 1000);
  cleanups.push(() => clearInterval(ticking));
  // A page put away mid-placement may never be shown again: what was placed is written at once.
  const keepPlacements = () => room.entities.flush();
  window.addEventListener('pagehide', keepPlacements);
  cleanups.push(() => window.removeEventListener('pagehide', keepPlacements));
  void stage.ended.then(() => dispatch(room, { type: 'session-ended' }));
}

/** Tells the state machine when his voice has gone quiet for long enough to arm the wake word, or stopped being. */
function reportQuiet(room: Room) {
  const quiet = room.conversation.quietFor(QUIET_BEFORE_ARMING_SECONDS);
  if (quiet === room.lastQuiet) return;
  room.lastQuiet = quiet;
  dispatch(room, { type: 'voice-quiet', quiet });
}

/** The passing of time, for everything in the state machine that waits on it. */
function passTime(room: Room) {
  reportQuiet(room);
  dispatch(room, { type: 'tick' });
}

/** Passes the wake engine's readiness on when it changed, or when the room is waiting to hear it. */
function reportReadiness(room: Room, readiness: WakeReadiness) {
  const last = room.lastReadiness;
  const same =
    last !== undefined &&
    last.kind === readiness.kind &&
    (last.kind !== 'not-listening' || readiness.kind !== 'not-listening' || last.problem === readiness.problem);
  if (same && !room.model.checkingWake) return;
  room.lastReadiness = readiness;
  dispatch(room, { type: 'wake-health', readiness });
}

/** What a select's ray is pointing at: the keyboard button, him, or neither — whichever is nearer. */
function targetOf(room: Room, ray: Ray | undefined): SelectEvent['target'] {
  if (ray === undefined) return 'elsewhere';
  const keyboard = room.panels.keyboard.visible
    ? raySphereDistance(ray, room.panels.keyboard.centre(), KEYBOARD_GLYPH_REACH_METRES)
    : undefined;
  // Where he is drawn now — following his anchor — rather than where he was first placed.
  const spot = room.hologramState === 'hidden' ? undefined : copyPoint(room.holder.position);
  const him = spot === undefined ? undefined : raySphereDistance(ray, spot, HIT_RADII * room.hologram.radius);
  if (keyboard !== undefined && (him === undefined || keyboard <= him)) return 'keyboard';
  return him === undefined ? 'elsewhere' : 'him';
}

function onSelect(room: Room, hold: SelectEvent['hold'], ray: Ray | undefined) {
  // A wake engine that needs user activation to recover gets it from the next select, which is
  // the only activation there is inside the room.
  const wake = room.options.wake;
  if (wake !== undefined && (wake.health.needsGesture || wake.health.state === 'broken')) {
    wake.rebuild().catch(() => undefined);
  }
  dispatch(room, { type: 'select', hold, target: targetOf(room, ray), ray });
}

/** Puts `event` through the state machine and carries out what comes back, one event at a time. */
function dispatch(room: Room, event: AppEvent) {
  // A part answering late — a timer, a promise — after the room has been let go of.
  if (room.released) return;
  room.queue.push(event);
  if (room.dispatching) return;
  room.dispatching = true;
  try {
    for (let next = room.queue.shift(); next !== undefined; next = room.queue.shift()) {
      const step = reduceApp(room.model, next, room.now());
      const changed = step.model !== room.model || step.effects.length > 0;
      room.model = step.model;
      for (const effect of step.effects) carryOut(room, effect);
      if (changed) {
        publishRoomDebugState(room.options.debug, sceneName(room.model), viewOf(room.model), step.effects);
      }
    }
  } finally {
    room.dispatching = false;
  }
  // Only once the step that ended the room has been carried out in full, so nothing in it reaches
  // for a part already let go of.
  if (room.returning) release(room);
}

function carryOut(room: Room, effect: AppEffect) {
  try {
    carryOutEffect(room, effect);
  } catch (error) {
    // One effect failing — a conversation call throwing, a panel failing to draw — must not stop
    // the rest of the step or the room.
    console.error(error);
  }
}

function carryOutEffect(room: Room, effect: AppEffect) {
  const { conversation, options, panels, sample } = room;
  switch (effect.type) {
    case 'place':
      room.pendingPlacement = { towards: effect.towards };
      return;
    case 'arrive':
      return arrive(room);
    case 'summon':
      return conversation.summon();
    case 'hang-up':
      return conversation.hangUp();
    case 'end-quietly':
      return conversation.endQuietly();
    case 'arm-wake':
      return options.wake?.arm();
    case 'disarm-wake':
      return options.wake?.disarm();
    case 'check-wake':
      return void checkWake(room);
    case 'hologram':
      return showHologram(room, effect.state);
    case 'show-panel':
      return panels.show(effect.panel, effect.lines);
    case 'hide-panel':
      return panels.hide(effect.panel);
    case 'set-frame-rate':
      return room.stage.setFrameRate(effect.target);
    case 'editing':
      return room.entities.setEditing(effect.active);
    case 'consume-held-selects':
      return room.input.consumeHeld();
    case 'start-sample':
    case 'cycle-sample':
      return sample.setMode(effect.mode);
    case 'stop-sample':
      return sample.stop();
    case 'open-keyboard':
      return room.keyboard.open();
    case 'close-keyboard':
      return room.keyboard.close();
    case 'set-typing':
      return conversation.setTyping(effect.typing);
    case 'send-text':
      return conversation.sendText(effect.text);
    case 'remember-problem':
      room.outcome.problem = effect.message;
      options.debug.problem = effect.message;
      return;
    case 'stop-microphone':
      return options.stopMicrophone?.();
    case 'exit-xr':
      return room.stage.end();
    case 'return-to-page':
      room.returning = true;
      return;
  }
}

/**
 * He appears at the spot just found — anchored there in the next frame — or, when a leaving is
 * cancelled, where he already stands, still following the anchor he had.
 */
function arrive(room: Room) {
  const spot = room.spot;
  if (spot !== undefined && room.freshSpot) {
    room.hologram.radius = spot.radius;
    room.holder.position.set(spot.position.x, spot.position.y, spot.position.z);
    room.pendingAnchor = copyPoint(spot.position);
    room.freshSpot = false;
  }
  room.goneReported = false;
  room.hologram.arrive();
}

function showHologram(room: Room, state: AppView['hologram']) {
  room.hologramState = state;
  room.holder.visible = state !== 'hidden';
  // Gone, rather than going: the spot and its anchor were for the visit that just ended.
  if (state === 'hidden') {
    room.anchors.clear();
    room.spot = undefined;
  }
}

/** Asks the wake engine how it is — rebuilding it if it is broken — and reports the answer. */
async function checkWake(room: Room) {
  const wake = room.options.wake;
  if (wake === undefined) return;
  if (wake.health.state === 'broken') await wake.rebuild().catch(() => undefined);
  room.lastReadiness = undefined;
  reportReadiness(room, readinessOf(wake.health));
}

/** Lets go of everything the room made, and hands the outcome back to the page. */
function release(room: Room) {
  if (room.released) return;
  room.released = true;
  room.input.dispose();
  room.inputs.dispose();
  unpublishEntities(room);
  room.entities.dispose();
  room.keyboard.dispose();
  room.depth?.dispose();
  room.anchors.clear();
  room.panels.dispose();
  room.hud?.dispose();
  room.hologram.dispose();
  room.conversation.dispose();
  room.placement.dispose?.();
  room.stage.dispose();
  room.finish();
}

function onFrame(room: Room, tick: XrFrameTick) {
  room.meter.frame(tick.time);
  room.options.debug.frames += 1;
  room.input.update(tick.frame, tick.referenceSpace);
  room.placement.observe?.({
    frame: tick.frame,
    referenceSpace: tick.referenceSpace,
    summoning: room.pendingPlacement !== undefined && !room.placing,
  });
  placeIfAsked(room, tick);
  if (room.pendingAnchor !== undefined) {
    room.anchors.place(tick.frame, tick.referenceSpace, room.pendingAnchor);
    room.pendingAnchor = undefined;
  }
  updateEntities(room, tick);
  drawHologram(room, tick);
  const spot = room.hologramState === 'hidden' ? undefined : copyPoint(room.holder.position);
  // After the hologram has followed his anchor this frame, so his voice is where he is drawn.
  room.options.voice?.follow(tick.centreEye, spot);
  const pointTo = room.hologramState === 'shown' && room.spot?.needsPointer === true;
  room.panels.arrange(tick.centreEye, spot, room.hologram.radius, tick.deltaSeconds, pointTo);
  room.hud?.follow(tick.centreEye);
  refreshReadouts(room, tick);
  passTime(room);
}

/** The things placed in the room, for this frame; what they report back is acted on here. */
function updateEntities(room: Room, tick: XrFrameTick) {
  const { scene } = room.model;
  const outcome = room.entities.update({
    frame: tick.frame,
    space: tick.referenceSpace,
    epoch: tick.epoch,
    eye: tick.centreEye,
    time: tick.time / 1000,
    deltaSeconds: tick.deltaSeconds,
    inputs: room.inputs.read(tick.frame, tick.referenceSpace),
    wristButton: scene.kind === 'waiting' || scene.kind === 'editing',
    thinking: room.conversation.thinking,
    live: room.conversation.phase === 'live',
    pretendWorking: scene.kind === 'sample' && scene.mode === 'thinking',
  });
  if (outcome.context !== undefined) room.conversation.sendContextualUpdate(outcome.context, POINTING_CONTEXT_ID);
  // Before Done, which this very frame may also have pressed with the drop that is still settling.
  if (outcome.settling !== room.lastSettling) {
    room.lastSettling = outcome.settling;
    dispatch(room, { type: 'drops-settling', settling: outcome.settling });
  }
  if (outcome.editButton) dispatch(room, { type: 'edit-button' });
  if (outcome.done) dispatch(room, { type: 'edit-done' });
}

/** Starts the placement a summon asked for, against this frame's head, gaze and depth. */
function placeIfAsked(room: Room, tick: XrFrameTick) {
  const asked = room.pendingPlacement;
  if (asked === undefined || room.placing) return;
  room.pendingPlacement = undefined;
  const eye = tick.centreEye;
  const head = copyPoint(eye.position);
  const request = {
    head,
    forward: asked.towards?.direction ?? copyPoint(gazeOf(eye)),
    depthProbes: room.depth?.probes(tick.frame, tick.referenceSpace, head) ?? [],
    previous: room.spot?.position,
  };
  const placed = (placement: PlacementLike) => {
    room.placing = false;
    room.spot = { ...placement, position: copyPoint(placement.position) };
    room.freshSpot = true;
    room.options.debug.hologramPosition = toRoomPoint(placement.position);
    room.options.debug.headPositionAtPlacement = toRoomPoint(head);
    room.options.debug.placement = {
      level: placement.level,
      clearance: placement.clearance,
      radius: placement.radius,
      needsPointer: placement.needsPointer,
    };
    dispatch(room, { type: 'placed' });
  };
  room.placing = true;
  try {
    const answer = room.placement.place(request);
    if (answer instanceof Promise) answer.then(placed, () => placed(fallbackPlacement(eye)));
    else placed(answer);
  } catch {
    placed(fallbackPlacement(eye));
  }
}

function drawHologram(room: Room, tick: XrFrameTick) {
  if (room.hologramState === 'hidden') return;
  const where = room.anchors.where(tick.frame, tick.referenceSpace);
  if (where !== undefined) room.holder.position.set(where.x, where.y, where.z);
  const leaving = room.hologramState === 'leaving';
  const drive =
    room.options.mode === 'sample'
      ? { ...room.sample.drive(), leaving }
      : {
          voice: room.conversation.voice,
          user: room.conversation.user,
          thinking: room.conversation.thinking,
          leaving,
        };
  room.hologram.update(tick.deltaSeconds, drive, tick.centreEye);
  if (leaving && room.hologram.presence <= 0 && !room.goneReported) {
    room.goneReported = true;
    dispatch(room, { type: 'presence-gone' });
  }
}

function refreshReadouts(room: Room, tick: XrFrameTick) {
  if (tick.time - room.lastReadout < READOUT_INTERVAL_MS) return;
  room.lastReadout = tick.time;
  const diagnostics = room.hologram.diagnostics;
  room.panels.setReadout(
    describeFrameRate(
      {
        rate: room.meter.rate,
        buildMilliseconds: diagnostics?.cpuMilliseconds ?? 0,
        share: diagnostics?.density ?? 1,
      },
      PARTICLE_COUNT,
    ),
  );
  room.hud?.update(collectDiagnostics(room));
}

/** Where he stands, for the HUD: how far placement had to relax, his size and his room. */
function describeSpot(spot: PlacementLike | undefined): string | undefined {
  if (spot === undefined) return undefined;
  const clearance = Number.isFinite(spot.clearance) ? `${spot.clearance.toFixed(2)} m clear` : 'room unknown';
  return `${spot.level}  r ${spot.radius.toFixed(2)} m  ${clearance}${spot.needsPointer ? '  arrow' : ''}`;
}

function collectDiagnostics(room: Room): Diagnostics {
  const { stage, options, conversation } = room;
  const wake = options.wake?.health;
  const described = room.placement.describe?.();
  return {
    scene: sceneName(room.model),
    xrVisibility: stage.visibility,
    documentVisibility: document.visibilityState,
    wake:
      wake === undefined
        ? undefined
        : {
            state: wake.state,
            level: wake.level,
            score: wake.score,
            chunksPerSecond: wake.chunksPerSecond,
            millisecondsPerChunk: wake.millisecondsPerChunk,
            armed: wake.armed,
            problem: wake.problem,
            needsGesture: wake.needsGesture,
          },
    conversation: {
      ...room.conversationDiagnostics,
      phase: conversation.phase,
      vadScore: conversation.user.getPresence(),
    },
    room: described === undefined ? undefined : { ...described, placement: describeSpot(room.spot) },
    xrFeatures: stage.session.enabledFeatures,
    frameRates: {
      supported: stage.supportedFrameRates,
      requested: stage.requestedFrameRate,
      measured: room.meter.rate,
    },
    frameMilliseconds: room.meter.frameMilliseconds,
    hologram: room.hologram.diagnostics,
    entities: room.entities.diagnostics(),
    webglExtensions: extensionsOfInterest(stage.renderer.getContext().getSupportedExtensions()),
    ...options.diagnostics?.(),
  };
}
