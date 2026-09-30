import type { AffectedEntity } from 'hologram';
import { Group } from 'three';
import type { EntitiesReport, EntityInputReport, RayReport, RoomPoint } from '../debug-hook';
import {
  type AffectedState,
  affectedIds,
  coronaLevels,
  markAffected,
  NOTHING_AFFECTED,
  releaseAffected,
  stepAffected,
} from '../entities/affected';
import {
  grabbersFrom,
  type HandReadings,
  indexTipsFrom,
  NO_HANDS,
  pointersFrom,
  readHands,
  wristButtonFrom,
} from '../entities/entity-input';
import {
  type CarriedToken,
  type Grabber,
  type GrabEvent,
  type GrabState,
  type GrabToken,
  HAND_REACH_METRES,
  NOTHING_GRABBED,
  stepGrab,
  TOKEN_RADIUS_METRES,
} from '../entities/grab';
import { fingerRay, pinchPoint } from '../entities/hand-pose';
import {
  NOT_POINTING,
  NOTHING_TOLD,
  type PointedEntity,
  type PointingContextState,
  type PointingState,
  pendingPointingContext,
  stepPointing,
  stepPointingContext,
} from '../entities/pointing';
import {
  createEntityStore,
  drawerEntries,
  type EntityRegistry,
  entityLabel,
  forgetAnchor,
  placedEntities,
  placeEntity,
  placementStateOf,
  recordEntities,
  unplaceEntity,
  unusedAnchors,
  usedAnchors,
} from '../entities/registry';
import { createRoomAnchors, type DropResult } from '../entities/room-anchors';
import { createCoronas } from '../hologram3d/corona';
import type { KeyValueStorage } from '../page/settings';
import type { Diagnostics } from '../ui3d/debug-hud';
import {
  buttonAlong,
  buttonPoint,
  buttonTouched,
  type DrawerButton,
  type DrawerPose,
  drawerPoseFacing,
  drawerSurfaceOf,
  drawerToRoom,
} from '../ui3d/drawer-layout';
import { createEntityDrawer, type DrawerSlot } from '../ui3d/entity-drawer';
import { createEntityLabels, type EntityLabel } from '../ui3d/entity-labels';
import { createEntityTokens, type TokenLook, type TokenSpot } from '../ui3d/entity-tokens';
import { createPointingReticle, reticleRadiusAt } from '../ui3d/pointing-reticle';
import { createWristButton } from '../ui3d/wrist-button';
import type { InputSnapshot } from '../xr/input-snapshots';
import { distanceBetween, type Ray, type Vector3Like } from '../xr/ray';
import { type CentreEye, pointAhead } from '../xr/viewer-pose';

/**
 * The things Jarvis works on, in the room: what the agent marks, where sir puts it, the corona
 * that lights round it while Jarvis is working on it, and what sir points at.
 *
 * One controller per room, called from the room's frame loop. Every frame it:
 *
 * 1. brings the room anchors up to date (`entities/room-anchors.ts`) — restoring the stored ones on
 *    the first frame — and writes down every drop that has since been given its anchor;
 * 2. finds each placed entity this frame, which it can only do once its anchor is located;
 * 3. reads the hands: pinches, pointing fingers, a raised wrist and the button on it;
 * 4. **while placing things**, runs the drawer and the grab (`entities/grab.ts`) — a token let go in
 *    the room is dropped on the nearest room anchor and written to the registry, one let go on the
 *    drawer is taken out of the room — and **otherwise** works out what sir points at
 *    (`entities/pointing.ts`), rings it, and says what the conversation should be told about it;
 * 5. lights the coronas (`entities/affected.ts`, `hologram3d/corona.ts`) round the placed entities
 *    Jarvis has marked, held while he is thinking.
 *
 * Every mark the agent makes is recorded in the registry whatever the room is doing, placed or not,
 * because the drawer offers what has ever been marked. The registry is written a moment after each
 * change and at once when the room closes or the page is hidden (`flush`).
 *
 * The room decides, through its state machine, whether sir is placing things; this only draws and
 * reads, and hands back what the room has to act on: a pointing update to send, and the wrist button
 * or the drawer's Done being pressed.
 */

/** One frame, as the controller is shown it. */
export interface EntitiesFrame {
  frame: XRFrame;
  space: XRReferenceSpace;
  eye: CentreEye;
  /** Seconds on the XR frame's clock. */
  time: number;
  deltaSeconds: number;
  inputs: readonly InputSnapshot[];
  /** Whether the wrist button does anything now: while waiting for the wake word, or placing things. */
  wristButton: boolean;
  /** Whether Jarvis is thinking, which holds a corona lit. */
  thinking: boolean;
  /** Whether the call is live, so what sir points at can be said. */
  live: boolean;
  /**
   * Sample mode's thinking mood: every placed entity is lit, as if he were working on them all —
   * how the corona can be seen without a call, and a beat for the demo.
   */
  pretendWorking: boolean;
}

/** What the room has to act on after a frame. */
export interface EntitiesOutcome {
  /** An update for the conversation about what sir points at, under `POINTING_CONTEXT_ID`. */
  context?: string;
  /** The wrist button was pressed: it opens placing things, and closes it. */
  editButton: boolean;
  /** The drawer's Done was pressed. */
  done: boolean;
  /**
   * Whether a drop is still waiting on the new anchor it will be kept on — which a room opened only
   * to place things stays open for, since it settles in a later frame.
   */
  settling: boolean;
}

export interface RoomEntities {
  /** Everything it draws, added to the scene as it is. */
  readonly object: Group;
  /** A `markAffected` call named these: recorded, and lit where they are placed. */
  affected(entities: readonly AffectedEntity[]): void;
  /** The conversation is over: every corona fades, whatever was holding it. */
  conversationEnded(): void;
  /** Placing things has started — the drawer opens in front of sir in the next frame — or stopped. */
  setEditing(active: boolean): void;
  /** Once per XR frame, from the room's frame loop. */
  update(frame: EntitiesFrame): EntitiesOutcome;
  /** What `window.__jarvis.entities` shows, worked out when it is read. */
  report(): EntitiesReport;
  /** The HUD's line. */
  diagnostics(): NonNullable<Diagnostics['entities']>;
  /** Writes the registry now, if a change is waiting. */
  flush(): void;
  dispose(): void;
}

export interface RoomEntitiesOptions {
  session: XRSession;
  storage: KeyValueStorage;
  /** Epoch milliseconds, for the registry, whose times have to mean the same thing next session. */
  clock?: () => number;
}

/** How long a line on the drawer about what just happened stays up, in seconds. */
const MESSAGE_SECONDS = 5;

/** How far above the point it names a label's lower edge hangs, over a token. */
const LABEL_ABOVE_TOKEN_METRES = 0.03;

/** How far beyond the reticle a pointed thing's name hangs. */
const LABEL_ABOVE_RETICLE_METRES = 0.012;

const LOOK_BY_STATE: Record<DrawerSlot['state'], TokenLook> = { unplaced: 'waiting', lost: 'lost', placed: 'placed' };

function roomPoint(point: Vector3Like): RoomPoint {
  return { x: point.x, y: point.y, z: point.z };
}

function rayReport(ray: Ray | undefined): RayReport | null {
  return ray === undefined ? null : { origin: roomPoint(ray.origin), direction: roomPoint(ray.direction) };
}

export function createRoomEntities(options: RoomEntitiesOptions): RoomEntities {
  const clock = options.clock ?? (() => Date.now());
  const store = createEntityStore(options.storage);
  const anchors = createRoomAnchors<XRSpace, XRRigidTransform>(
    options.session,
    (position) => new XRRigidTransform(position),
  );
  const drawer = createEntityDrawer();
  const tokens = createEntityTokens();
  const labels = createEntityLabels();
  const reticle = createPointingReticle();
  const wrist = createWristButton();
  const coronas = createCoronas();
  const object = new Group();
  object.add(drawer.object, ...tokens.objects, labels.object, reticle.object, wrist.object, coronas.object);

  let restored = false;
  let time = 0;
  let editing = false;
  let openDrawer = false;
  let inputs: readonly InputSnapshot[] = [];
  let hands: HandReadings = NO_HANDS;
  let wristButton: Vector3Like | undefined;
  let wristTouched = false;
  /** Fingertips on one of the drawer's buttons in the last frame, so a touch presses it once. */
  let fingersOnButtons = new Set<string>();
  /** Each grabber's select in the last frame, so a press along a ray at a button is seen once. */
  let selecting = new Map<string, boolean>();
  /** Grabbers whose select pressed a button: the grab is not shown it until it is let go. */
  const pressedButton = new Set<string>();
  let grab: GrabState = NOTHING_GRABBED;
  let carried: CarriedToken[] = [];
  let pointing: PointingState = NOT_POINTING;
  let told: PointingContextState = NOTHING_TOLD;
  let lit: AffectedState = NOTHING_AFFECTED;
  const marks: string[] = [];
  /** Entities dropped onto an anchor still being made; a later unplacing takes one out again. */
  const awaitingAnchor = new Set<string>();
  let message: { text: string; until: number } | undefined;
  /** What the drawer was last shown, so it is sorted and handed over again only when that changes. */
  let shown: { registry: EntityRegistry; message: string | undefined } | undefined;
  let positions = new Map<string, Vector3Like>();
  let slots: DrawerSlot[] = [];
  let drawnCoronas: { id: string; level: number; position: Vector3Like }[] = [];

  function labelOf(id: string): string {
    const entity = store.registry.entities[id];
    return entity === undefined ? id : entityLabel(entity);
  }

  function say(text: string) {
    message = { text, until: time + MESSAGE_SECONDS };
  }

  function forgetAnchors(uuids: readonly string[]) {
    if (uuids.length > 0) store.update((registry) => uuids.reduce<EntityRegistry>(forgetAnchor, registry));
  }

  /**
   * Gives `uuids`' persistent handles back to the headset, and forgets each one only once the
   * headset has let go of it: one it refused stays in the registry, to be given back next session,
   * rather than using one of the origin's eight with nothing left that knows its handle.
   */
  function releaseAnchors(uuids: readonly string[]) {
    if (uuids.length > 0) void anchors.release(uuids).then(forgetAnchors);
  }

  /** Writes down what became of a drop: on its anchor, waiting for one, or not kept. */
  function keep(result: DropResult) {
    if (result.kind === 'pending') {
      awaitingAnchor.add(result.id);
      return;
    }
    awaitingAnchor.delete(result.id);
    if (result.kind === 'failed') {
      say(`${labelOf(result.id)} could not be kept here. ${result.reason}`);
      return;
    }
    store.update((registry) => placeEntity(registry, result.id, result.anchor, result.offset, clock()));
    say(`${labelOf(result.id)} is kept here.`);
  }

  /** The anchors brought up to date, and every drop they have settled since written down. */
  function settleAnchors(frame: EntitiesFrame) {
    if (!restored) {
      restored = true;
      forgetAnchors(anchors.restore(usedAnchors(store.registry), time));
      // Left over from a session that ended before the headset let go of them, or refused to.
      releaseAnchors(unusedAnchors(store.registry));
    }
    let kept = false;
    for (const settled of anchors.update(frame.frame, frame.space, time)) {
      if (awaitingAnchor.has(settled.id)) {
        keep(settled);
        kept = true;
        continue;
      }
      // Nobody waits for it any more, so an anchor no placement names — the one made for this drop —
      // is given back rather than left holding one of the origin's eight with nothing to find it by.
      if (settled.kind === 'placed' && !Object.hasOwn(store.registry.anchors, settled.anchor)) {
        releaseAnchors([settled.anchor]);
      }
    }
    // Kept after placing things ended, which Done may do while a drop settles: moving an entity onto
    // its new anchor may have left its old one unused, after the ending gave back what it could see.
    if (kept && !editing) releaseAnchors(unusedAnchors(store.registry));
  }

  /** Where each placed entity is this frame: on its located anchor, or where it waits for one. */
  function locate(): Map<string, Vector3Like> {
    const found = new Map<string, Vector3Like>();
    for (const entity of placedEntities(store.registry)) {
      const position = entity.placement === undefined ? undefined : anchors.positionOf(entity.placement);
      if (position !== undefined) found.set(entity.id, position);
    }
    for (const drop of anchors.pendingDrops()) if (awaitingAnchor.has(drop.id)) found.set(drop.id, drop.position);
    return found;
  }

  /** The wrist button: shown where it stands, and pressed once when a fingertip first touches it. */
  function readWrist(frame: EntitiesFrame, outcome: EntitiesOutcome) {
    const reading = frame.wristButton ? wristButtonFrom(frame.inputs, hands) : { touched: false };
    wristButton = reading.position;
    const touched = reading.position !== undefined && reading.touched;
    if (touched && !wristTouched) outcome.editButton = true;
    wristTouched = touched;
    wrist.show(reading.position, frame.eye.position, touched);
  }

  function pressDrawer(button: DrawerButton, outcome: EntitiesOutcome) {
    if (drawer.press(button) === 'done') outcome.done = true;
  }

  function nearAToken(point: Vector3Like | undefined, grabTokens: readonly GrabToken[]): boolean {
    if (point === undefined) return false;
    return grabTokens.some(
      (token) => distanceBetween(point, token.position) - TOKEN_RADIUS_METRES <= HAND_REACH_METRES,
    );
  }

  /**
   * The drawer's buttons, pressed by a fingertip on one, or by a select along a ray at one — a hand's
   * pinch only when it is not on a token, which it would be taking. Returns the grabbers as the grab
   * should see them: one whose select pressed a button holds nothing until it is let go.
   */
  function readDrawerButtons(
    grabbers: readonly Grabber[],
    grabTokens: readonly GrabToken[],
    outcome: EntitiesOutcome,
  ): Grabber[] {
    const pose = drawer.pose;
    if (pose === undefined) return [...grabbers];
    const enabled = drawer.buttons();
    pressWithFingers(pose, enabled, outcome);
    const carrying = new Set(carried.map((token) => token.grabber));
    const seen = grabbers.map((grabber) => {
      const button = carrying.has(grabber.id) ? undefined : buttonSelected(pose, enabled, grabber, grabTokens);
      if (button !== undefined) {
        pressedButton.add(grabber.id);
        pressDrawer(button, outcome);
      }
      if (!grabber.holding && !grabber.selecting) pressedButton.delete(grabber.id);
      return pressedButton.has(grabber.id) ? { ...grabber, holding: false, selecting: false } : grabber;
    });
    selecting = new Map(grabbers.map((grabber) => [grabber.id, grabber.selecting]));
    return seen;
  }

  /** Presses each button a fingertip has just touched. */
  function pressWithFingers(pose: DrawerPose, enabled: ReadonlySet<DrawerButton>, outcome: EntitiesOutcome) {
    const fingers = new Set<string>();
    for (const { id, tip } of indexTipsFrom(inputs)) {
      const button = buttonTouched(pose, tip, enabled);
      if (button === undefined) continue;
      fingers.add(id);
      if (!fingersOnButtons.has(id)) pressDrawer(button, outcome);
    }
    fingersOnButtons = fingers;
  }

  /** The button `grabber` has just selected along its ray, if any: never with a hand that is on a token. */
  function buttonSelected(
    pose: DrawerPose,
    enabled: ReadonlySet<DrawerButton>,
    grabber: Grabber,
    grabTokens: readonly GrabToken[],
  ): DrawerButton | undefined {
    const pressed = grabber.selecting && selecting.get(grabber.id) !== true;
    if (!pressed || grabber.ray === undefined) return undefined;
    if (grabber.kind === 'hand' && nearAToken(grabber.grip, grabTokens)) return undefined;
    return buttonAlong(pose, grabber.ray, enabled);
  }

  function onGrab(event: GrabEvent, frame: EntitiesFrame) {
    if (event.kind === 'placed') {
      keep(anchors.drop(frame.frame, frame.space, event.id, event.position, store.registry, time));
    } else if (event.kind === 'unplaced') {
      // Back in the drawer before its anchor was made: the drop, and the anchor on its way, are let go.
      awaitingAnchor.delete(event.id);
      anchors.cancel(event.id);
      if (placementStateOf(store.registry, event.id) === 'unplaced') return;
      store.update((registry) => unplaceEntity(registry, event.id));
      say(`${labelOf(event.id)} is back in the drawer.`);
    }
  }

  /** The drawer, the tokens and the grab: taking things and putting them somewhere. */
  function edit(frame: EntitiesFrame, outcome: EntitiesOutcome) {
    if (openDrawer) {
      openDrawer = false;
      const ahead = pointAhead(frame.eye, 1).sub(frame.eye.position);
      drawer.open(drawerPoseFacing(frame.eye.position, ahead));
    }
    if (message !== undefined && time >= message.until) message = undefined;
    if (shown?.registry !== store.registry || shown.message !== message?.text) {
      shown = { registry: store.registry, message: message?.text };
      drawer.show(drawerEntries(store.registry), message?.text);
    }
    // One token per entity: an entity standing in the room is taken from there, not from its slot.
    slots = drawer.slots();
    const fromDrawer = slots.filter((slot) => !positions.has(slot.id));
    const grabTokens: GrabToken[] = [
      ...fromDrawer.map((slot) => ({ id: slot.id, position: slot.position, from: 'drawer' as const })),
      ...[...positions].map(([id, position]) => ({ id, position, from: 'room' as const })),
    ];
    const grabbers = readDrawerButtons(grabbersFrom(frame.inputs, hands), grabTokens, outcome);
    const pose = drawer.pose;
    const step = stepGrab(grab, {
      grabbers,
      tokens: grabTokens,
      drawer: pose === undefined ? undefined : drawerSurfaceOf(pose),
      deltaSeconds: frame.deltaSeconds,
    });
    grab = step.state;
    carried = step.carried;
    for (const event of step.events) onGrab(event, frame);
    drawTokens(frame, fromDrawer);
  }

  function drawTokens(frame: EntitiesFrame, fromDrawer: readonly DrawerSlot[]) {
    const inHand = new Set(carried.map((token) => token.id));
    // Found again, so a token let go this frame stands where it was put rather than vanishing for a frame.
    positions = locate();
    const standing = [...positions].filter(([id]) => !inHand.has(id));
    const spots: TokenSpot[] = [
      ...fromDrawer
        .filter((slot) => !inHand.has(slot.id))
        .map((slot) => ({ position: slot.position, look: LOOK_BY_STATE[slot.state] })),
      ...standing.map(([, position]) => ({ position, look: 'placed' as const })),
      ...carried.map((token) => ({ position: token.position, look: 'carried' as const })),
    ];
    tokens.set(spots, frame.eye.position);
    const named: EntityLabel[] = [
      ...carried.map((token) => ({
        key: `carried ${token.id}`,
        text: labelOf(token.id),
        position: token.position,
        above: LABEL_ABOVE_TOKEN_METRES,
      })),
      ...standing.map(([id, position]) => ({
        key: `placed ${id}`,
        text: labelOf(id),
        position,
        above: LABEL_ABOVE_TOKEN_METRES,
      })),
    ];
    labels.set(named, frame.eye.position);
  }

  /** The entity `id` as the conversation is told about it: its id to act on, and its name to say. */
  function pointedEntity(id: string | undefined): PointedEntity | undefined {
    const entity = id === undefined ? undefined : store.registry.entities[id];
    if (entity === undefined) return undefined;
    return entity.name === undefined ? { id: entity.id } : { id: entity.id, name: entity.name };
  }

  /** What sir points at: chosen, ringed, named, and what the conversation should be told about it. */
  function point(frame: EntitiesFrame, outcome: EntitiesOutcome) {
    const targets = [...positions].map(([id, position]) => ({ id, position }));
    pointing = stepPointing(pointing, pointersFrom(frame.inputs, hands), targets, time);
    const pointed = pointing.pointed;
    const contextStep = stepPointingContext(told, pointedEntity(pointed?.id), frame.live, time);
    told = contextStep.state;
    if (contextStep.send !== undefined) outcome.context = contextStep.send;
    const position = pointed === undefined ? undefined : positions.get(pointed.id);
    reticle.show(position, frame.eye.position, pointed === undefined ? 0 : time - pointed.since);
    if (pointed === undefined || position === undefined) {
      labels.set([], frame.eye.position);
      return;
    }
    const radius = reticleRadiusAt(distanceBetween(position, frame.eye.position));
    labels.set(
      [
        {
          key: `pointed ${pointed.id}`,
          text: labelOf(pointed.id),
          position,
          above: radius + LABEL_ABOVE_RETICLE_METRES,
        },
      ],
      frame.eye.position,
    );
  }

  /** The coronas: lit by marks, held while he thinks, drawn round the placed ones. */
  function light(frame: EntitiesFrame) {
    if (marks.length > 0) lit = markAffected(lit, marks.splice(0), time);
    if (frame.pretendWorking) lit = markAffected(lit, [...positions.keys()], time);
    lit = stepAffected(lit, time, frame.thinking || frame.pretendWorking);
    drawnCoronas = coronaLevels(lit).flatMap(({ id, level }) => {
      const position = positions.get(id);
      return position === undefined ? [] : [{ id, level, position }];
    });
    coronas.set(drawnCoronas);
    coronas.update(frame.deltaSeconds, frame.eye.position);
  }

  function stopEditing() {
    drawer.close();
    grab = NOTHING_GRABBED;
    carried = [];
    slots = [];
    pressedButton.clear();
    tokens.set([], { x: 0, y: 0, z: 0 });
    // The handles no placement uses any more go back to the origin's eight. The room ends the
    // session only after this (`reduceApp`), so the headset is asked while it can still answer.
    releaseAnchors(unusedAnchors(store.registry));
    store.flush();
  }

  function buttonsReport(): EntitiesReport['drawer']['buttons'] {
    const pose = drawer.pose;
    if (pose === undefined) return [];
    return [...drawer.buttons()].map((button) => ({
      button,
      worldPosition: roomPoint(drawerToRoom(pose, buttonPoint(button))),
    }));
  }

  function inputReport(input: InputSnapshot): EntityInputReport {
    const reading = hands.get(input.id);
    const joints = input.joints;
    const grip = input.kind === 'hand' ? joints && pinchPoint(joints) : input.grip;
    const tip = joints?.['index-finger-tip'];
    return {
      id: input.id,
      kind: input.kind,
      pinching: reading?.pinching ?? input.buttons?.squeeze ?? false,
      pointing: reading?.pointing ?? false,
      wristRaised: reading?.wristRaised ?? false,
      grip: grip === undefined ? null : roomPoint(grip),
      indexTip: tip === undefined ? null : roomPoint(tip),
      ray: rayReport(input.targetRay),
      fingerRay: reading?.pointing === true && joints !== undefined ? rayReport(fingerRay(joints)) : null,
    };
  }

  return {
    object,
    affected(entities) {
      store.update((registry) => recordEntities(registry, entities, clock()));
      marks.push(...entities.map((entity) => entity.id));
    },
    conversationEnded() {
      if (marks.length > 0) lit = markAffected(lit, marks.splice(0), time);
      lit = releaseAffected(lit);
    },
    setEditing(active) {
      if (active === editing) return;
      editing = active;
      if (active) {
        openDrawer = true;
        shown = undefined;
        pointing = NOT_POINTING;
        reticle.show(undefined, { x: 0, y: 0, z: 0 }, 0);
      } else {
        stopEditing();
      }
    },
    update(frame) {
      time = frame.time;
      inputs = frame.inputs;
      const outcome: EntitiesOutcome = { editButton: false, done: false, settling: false };
      settleAnchors(frame);
      positions = locate();
      hands = readHands(hands, frame.inputs, frame.eye.position);
      readWrist(frame, outcome);
      if (editing) edit(frame, outcome);
      else point(frame, outcome);
      light(frame);
      outcome.settling = awaitingAnchor.size > 0;
      return outcome;
    },
    report() {
      const registry = store.registry;
      const status = anchors.status(time);
      return {
        known: drawerEntries(registry).map((entry) => entry.id),
        placed: placedEntities(registry).map((entity) => {
          const position = positions.get(entity.id);
          return {
            id: entity.id,
            anchor: entity.placement?.anchor ?? '',
            position: position === undefined ? null : roomPoint(position),
          };
        }),
        affected: affectedIds(lit),
        coronas: drawnCoronas.map((corona) => ({ ...corona, position: roomPoint(corona.position) })),
        pointed: pointing.pointed?.id ?? null,
        pendingContext: pendingPointingContext(told, time) ?? null,
        drawer: {
          open: drawer.pose !== undefined,
          page: drawer.page,
          slots: slots.map((slot) => ({
            id: slot.id,
            label: slot.label,
            state: slot.state,
            worldPosition: roomPoint(slot.position),
          })),
          buttons: buttonsReport(),
        },
        carried: carried.map((token) => ({
          id: token.id,
          grabber: token.grabber,
          mode: token.mode,
          over: token.over,
          position: roomPoint(token.position),
        })),
        inputs: inputs.map(inputReport),
        wristButton: wristButton === undefined ? null : roomPoint(wristButton),
        anchors: { states: status.anchors, notFound: status.notFound, pending: status.pending },
        message: message?.text ?? null,
        writeProblem: store.writeProblem ?? null,
      };
    },
    diagnostics() {
      const registry = store.registry;
      const status = anchors.status(time);
      const states = Object.values(status.anchors);
      const pointed = pointing.pointed?.id;
      return {
        known: Object.keys(registry.entities).length,
        placed: placedEntities(registry).length,
        here: positions.size,
        anchorsLocated: states.filter((state) => state === 'located').length,
        anchors: states.length,
        lit: drawnCoronas.length,
        ...(pointed === undefined ? {} : { pointed: labelOf(pointed) }),
        ...(store.writeProblem === undefined ? {} : { problem: store.writeProblem }),
      };
    },
    flush() {
      store.flush();
    },
    dispose() {
      // Drops the session ended under: their anchors will never be written down, so they are given
      // back — as far as a session that has ended still allows.
      for (const id of awaitingAnchor) anchors.cancel(id);
      store.flush();
      drawer.dispose();
      tokens.dispose();
      labels.dispose();
      reticle.dispose();
      wrist.dispose();
      coronas.dispose();
    },
  };
}
