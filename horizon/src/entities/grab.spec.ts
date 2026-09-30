import { describe, expect, it } from 'bun:test';
import type { Ray, Vector3Like } from '../xr/ray';
import {
  type DrawerSurface,
  FAR_PICK_DEGREES,
  type Grabber,
  type GrabEvent,
  type GrabFrame,
  type GrabState,
  type GrabStep,
  type GrabToken,
  HAND_REACH_METRES,
  isOnDrawer,
  NOTHING_GRABBED,
  PICK_OCCLUSION_SLACK_METRES,
  REACH_FACTOR_PER_SECOND,
  rayDrawerDistance,
  stepGrab,
  TOKEN_RADIUS_METRES,
} from './grab';

/** The drawer as a lectern-like rectangle 45 cm ahead at waist height, facing the user. */
const DRAWER: DrawerSurface = {
  centre: { x: 0, y: 1.2, z: -0.45 },
  right: { x: 1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  normal: { x: 0, y: 0, z: 1 },
  halfWidth: 0.15,
  halfHeight: 0.1,
};

const KITCHEN: GrabToken = { id: 'light.kitchen', position: { x: -0.05, y: 1.2, z: -0.43 }, from: 'drawer' };
const INBOX: GrabToken = { id: 'inbox:work', position: { x: 0.05, y: 1.2, z: -0.43 }, from: 'drawer' };
const CEILING: GrabToken = { id: 'light.ceiling', position: { x: 1, y: 2.4, z: -3 }, from: 'room' };
const TOKENS = [KITCHEN, INBOX, CEILING];

const EYE = { x: 0, y: 1.5, z: 0 };

/** A ray from `origin` towards `towards`. */
function rayTowards(towards: Vector3Like, origin: Vector3Like = EYE): Ray {
  const x = towards.x - origin.x;
  const y = towards.y - origin.y;
  const z = towards.z - origin.z;
  const length = Math.hypot(x, y, z);
  return { origin, direction: { x: x / length, y: y / length, z: z / length } };
}

function hand(overrides: Partial<Grabber> = {}): Grabber {
  return { id: 'right-hand', kind: 'hand', holding: false, selecting: false, ...overrides };
}

function pinching(grip: Vector3Like | undefined, ray?: Ray, overrides: Partial<Grabber> = {}): Grabber {
  return hand({ grip, ray, holding: true, selecting: true, ...overrides });
}

function controller(overrides: Partial<Grabber> = {}): Grabber {
  return { id: 'right-controller', kind: 'controller', holding: false, selecting: false, ...overrides };
}

/** Runs the grabbers of each frame in turn, collecting every event. */
function run(frames: Grabber[][], start: GrabState = NOTHING_GRABBED, deltaSeconds = 1 / 72) {
  let state = start;
  const events: GrabEvent[] = [];
  let last: GrabStep | undefined;
  for (const grabbers of frames) {
    const frame: GrabFrame = { grabbers, tokens: TOKENS, drawer: DRAWER, deltaSeconds };
    last = stepGrab(state, frame);
    state = last.state;
    events.push(...last.events);
  }
  return { state, events, carried: last?.carried ?? [] };
}

describe('the drawer', () => {
  it('counts a point on its rectangle, give or take a few centimetres, as on it', () => {
    expect(isOnDrawer(DRAWER, { x: 0.1, y: 1.25, z: -0.42 })).toBe(true);
    expect(isOnDrawer(DRAWER, { x: 0.3, y: 1.2, z: -0.45 })).toBe(false);
    expect(isOnDrawer(DRAWER, { x: 0, y: 1.2, z: -0.3 })).toBe(false);
    expect(isOnDrawer(undefined, DRAWER.centre)).toBe(false);
  });

  it('is met by a ray through its rectangle, and missed by one past it or turned away', () => {
    expect(rayDrawerDistance(rayTowards(DRAWER.centre), DRAWER)).toBeCloseTo(Math.hypot(0.3, 0.45), 6);
    expect(rayDrawerDistance(rayTowards({ x: 0.5, y: 1.2, z: -0.45 }), DRAWER)).toBeUndefined();
    expect(rayDrawerDistance({ origin: EYE, direction: { x: 0, y: 0, z: 1 } }, DRAWER)).toBeUndefined();
    expect(rayDrawerDistance({ origin: EYE, direction: { x: 1, y: 0, z: 0 } }, DRAWER)).toBeUndefined();
  });
});

describe('near, with a hand', () => {
  it('takes the token under a pinch, carries it, and places it where the pinch lets go', () => {
    const lamp = { x: 0.4, y: 1.6, z: -0.6 };
    const { events, carried } = run([
      [hand({ grip: KITCHEN.position })],
      [pinching({ x: -0.04, y: 1.21, z: -0.43 })],
      [pinching({ x: 0.2, y: 1.4, z: -0.5 })],
    ]);
    expect(events).toEqual([
      { kind: 'grabbed', id: 'light.kitchen', grabber: 'right-hand', mode: 'near', from: 'drawer' },
    ]);
    expect(carried).toEqual([
      { id: 'light.kitchen', grabber: 'right-hand', mode: 'near', position: { x: 0.2, y: 1.4, z: -0.5 }, over: 'room' },
    ]);
    const after = run([[pinching(KITCHEN.position)], [pinching(lamp)], [hand({ grip: lamp })]]);
    expect(after.events.at(-1)).toEqual({ kind: 'placed', id: 'light.kitchen', position: lamp });
    expect(after.carried).toEqual([]);
  });

  it(`takes nothing more than ${HAND_REACH_METRES * 100} cm from a token's edge`, () => {
    const out = {
      x: KITCHEN.position.x,
      y: KITCHEN.position.y + TOKEN_RADIUS_METRES + HAND_REACH_METRES + 0.01,
      z: -0.43,
    };
    expect(run([[pinching(out)]]).events).toEqual([]);
  });

  it('takes the nearer of two tokens', () => {
    const { events } = run([[pinching({ x: 0.03, y: 1.2, z: -0.43 })]]);
    expect(events[0]).toMatchObject({ kind: 'grabbed', id: 'inbox:work' });
  });

  it('puts a token let go on the drawer back in', () => {
    const onDrawer = { x: 0.1, y: 1.15, z: -0.44 };
    const { events } = run([[pinching(KITCHEN.position)], [pinching(onDrawer)], [hand({ grip: onDrawer })]]);
    expect(events.at(-1)).toEqual({ kind: 'unplaced', id: 'light.kitchen' });
  });

  it('moves a token already placed in the room', () => {
    const { events } = run([
      [pinching(CEILING.position)],
      [pinching({ x: 1.2, y: 2.4, z: -3 })],
      [hand({ grip: { x: 1.2, y: 2.4, z: -3 } })],
    ]);
    expect(events).toEqual([
      { kind: 'grabbed', id: 'light.ceiling', grabber: 'right-hand', mode: 'near', from: 'room' },
      { kind: 'placed', id: 'light.ceiling', position: { x: 1.2, y: 2.4, z: -3 } },
    ]);
  });

  it('takes only on the pinch starting, not while one is held', () => {
    const held = pinching({ x: 0.5, y: 1.5, z: -0.5 });
    const { events } = run([[held], [pinching(KITCHEN.position)]]);
    expect(events).toEqual([]);
  });

  it('cancels a carry whose hand stops being tracked, or leaves the frame', () => {
    const lost = run([[pinching(KITCHEN.position)], [pinching(undefined)]]);
    expect(lost.events.at(-1)).toEqual({ kind: 'cancelled', id: 'light.kitchen' });
    expect(lost.carried).toEqual([]);
    const gone = run([[pinching(KITCHEN.position)], []]);
    expect(gone.events.at(-1)).toEqual({ kind: 'cancelled', id: 'light.kitchen' });
  });

  it('never lets two hands hold the same token', () => {
    const left = (grip: Vector3Like) => hand({ id: 'left-hand', grip, holding: true, selecting: true });
    // Halfway between the two tokens: the nearer one is held already, so the other is taken.
    const between = { x: 0, y: 1.2, z: -0.43 };
    const { events, carried } = run([[pinching(KITCHEN.position)], [pinching(KITCHEN.position), left(between)]]);
    expect(events).toEqual([
      { kind: 'grabbed', id: 'light.kitchen', grabber: 'right-hand', mode: 'near', from: 'drawer' },
      { kind: 'grabbed', id: 'inbox:work', grabber: 'left-hand', mode: 'near', from: 'drawer' },
    ]);
    expect(carried.map((token) => token.id)).toEqual(['light.kitchen', 'inbox:work']);
  });
});

describe('far, along a ray', () => {
  /** Far from every token, pointing at `towards`. */
  const HAND_AT = { x: 0.25, y: 1.1, z: -0.2 };
  const aim = (towards: Vector3Like, overrides: Partial<Grabber> = {}) =>
    hand({ grip: HAND_AT, ray: rayTowards(towards, HAND_AT), ...overrides });
  const pinchAim = (towards: Vector3Like, overrides: Partial<Grabber> = {}) =>
    aim(towards, { holding: true, selecting: true, ...overrides });

  it('picks the token a pinch points at, and rides it to where the ray meets the room', () => {
    const lamp = { x: 1.5, y: 2.4, z: -2.5 };
    const hit = Math.hypot(lamp.x - HAND_AT.x, lamp.y - HAND_AT.y, lamp.z - HAND_AT.z);
    const { events, carried } = run([
      [aim(KITCHEN.position)],
      [pinchAim(KITCHEN.position)],
      [aim(KITCHEN.position)],
      [aim(lamp, { hitDistance: hit })],
    ]);
    expect(events).toEqual([
      { kind: 'grabbed', id: 'light.kitchen', grabber: 'right-hand', mode: 'far', from: 'drawer' },
    ]);
    expect(carried[0]?.over).toBe('room');
    expect(carried[0]?.position.x).toBeCloseTo(lamp.x, 6);
    expect(carried[0]?.position.y).toBeCloseTo(lamp.y, 6);
    expect(carried[0]?.position.z).toBeCloseTo(lamp.z, 6);
  });

  it('drops it where the ray meets the room on the next pinch, not on letting go', () => {
    const lamp = { x: 1.5, y: 2.4, z: -2.5 };
    const hit = Math.hypot(lamp.x - HAND_AT.x, lamp.y - HAND_AT.y, lamp.z - HAND_AT.z);
    const { events } = run([
      [pinchAim(KITCHEN.position)],
      [aim(lamp, { hitDistance: hit })],
      [pinchAim(lamp, { hitDistance: hit })],
      [aim(lamp, { hitDistance: hit })],
    ]);
    expect(events).toHaveLength(2);
    const placed = events[1];
    if (placed?.kind !== 'placed') throw new Error('Expected a placement.');
    expect(placed.position.x).toBeCloseTo(lamp.x, 6);
    expect(placed.position.y).toBeCloseTo(lamp.y, 6);
    expect(placed.position.z).toBeCloseTo(lamp.z, 6);
  });

  it('keeps the last distance when the ray meets nothing', () => {
    const lamp = { x: 1.5, y: 2.4, z: -2.5 };
    const hit = Math.hypot(lamp.x - HAND_AT.x, lamp.y - HAND_AT.y, lamp.z - HAND_AT.z);
    const elsewhere = { x: 2, y: 2, z: -2 };
    const { carried } = run([[pinchAim(KITCHEN.position)], [aim(lamp, { hitDistance: hit })], [aim(elsewhere)]]);
    const position = carried[0]?.position;
    if (position === undefined) throw new Error('Nothing carried.');
    expect(Math.hypot(position.x - HAND_AT.x, position.y - HAND_AT.y, position.z - HAND_AT.z)).toBeCloseTo(hit, 6);
  });

  it("pushes a controller's riding token out with the thumbstick", () => {
    const origin = { x: 0.2, y: 1.1, z: -0.1 };
    const pointing = (towards: Vector3Like, overrides: Partial<Grabber> = {}) =>
      controller({ grip: origin, ray: rayTowards(towards, origin), ...overrides });
    const ahead = { x: 0.2, y: 1.1, z: -3 };
    const start = run([[pointing(KITCHEN.position, { selecting: true })], [pointing(ahead)]]);
    const before = start.carried[0]?.position;
    const pushed = run([[pointing(ahead, { reach: 1 })]], start.state, 1);
    const after = pushed.carried[0]?.position;
    if (before === undefined || after === undefined) throw new Error('Nothing carried.');
    const distance = (point: Vector3Like) => Math.hypot(point.x - origin.x, point.y - origin.y, point.z - origin.z);
    expect(distance(after) / distance(before)).toBeCloseTo(REACH_FACTOR_PER_SECOND, 6);
  });

  it('puts a riding token back in when dropped on the drawer', () => {
    const { events, carried } = run([
      [pinchAim(CEILING.position)],
      [aim(DRAWER.centre, { hitDistance: 5 })],
      [pinchAim(DRAWER.centre, { hitDistance: 5 })],
    ]);
    expect(carried).toEqual([]);
    expect(events).toEqual([
      { kind: 'grabbed', id: 'light.ceiling', grabber: 'right-hand', mode: 'far', from: 'room' },
      { kind: 'unplaced', id: 'light.ceiling' },
    ]);
  });

  it(`picks a small token far off within ${FAR_PICK_DEGREES}°, and not beyond`, () => {
    const direction = (degrees: number) => {
      const radians = (degrees * Math.PI) / 180;
      const toward = rayTowards(CEILING.position, HAND_AT).direction;
      // Turned about the vertical by `degrees`.
      return {
        x: toward.x * Math.cos(radians) + toward.z * Math.sin(radians),
        y: toward.y,
        z: -toward.x * Math.sin(radians) + toward.z * Math.cos(radians),
      };
    };
    const within = run([[pinchAim(CEILING.position, { ray: { origin: HAND_AT, direction: direction(2) } })]]);
    expect(within.events[0]).toMatchObject({ kind: 'grabbed', id: 'light.ceiling' });
    const beyond = run([[pinchAim(CEILING.position, { ray: { origin: HAND_AT, direction: direction(4.5) } })]]);
    expect(beyond.events).toEqual([]);
  });

  it('passes over a token beyond the surface the ray hit', () => {
    const distance = Math.hypot(
      CEILING.position.x - HAND_AT.x,
      CEILING.position.y - HAND_AT.y,
      CEILING.position.z - HAND_AT.z,
    );
    const blocked = run([[pinchAim(CEILING.position, { hitDistance: distance - PICK_OCCLUSION_SLACK_METRES - 0.2 })]]);
    expect(blocked.events).toEqual([]);
    const onSurface = run([[pinchAim(CEILING.position, { hitDistance: distance - 0.05 })]]);
    expect(onSurface.events[0]).toMatchObject({ kind: 'grabbed', id: 'light.ceiling' });
  });

  it('cancels a riding token whose ray is lost', () => {
    const { events } = run([[pinchAim(KITCHEN.position)], [hand({ grip: HAND_AT })]]);
    expect(events.at(-1)).toEqual({ kind: 'cancelled', id: 'light.kitchen' });
  });
});

describe('controllers', () => {
  it('take a token within reach with the grip, and let go when it is released', () => {
    const spot = { x: 0.6, y: 1.0, z: -0.8 };
    const { events } = run([
      [controller({ grip: INBOX.position, holding: true })],
      [controller({ grip: spot, holding: true })],
      [controller({ grip: spot })],
    ]);
    expect(events).toEqual([
      { kind: 'grabbed', id: 'inbox:work', grabber: 'right-controller', mode: 'near', from: 'drawer' },
      { kind: 'placed', id: 'inbox:work', position: spot },
    ]);
  });

  it('take nothing within reach with the trigger alone: the trigger is the far grab', () => {
    const away = { x: 0, y: 0, z: 1 };
    const { events } = run([
      [controller({ grip: INBOX.position, selecting: true, ray: rayTowards(away, INBOX.position) })],
    ]);
    expect(events).toEqual([]);
  });

  it('pick along the ray with the trigger, and drop with it again', () => {
    const origin = { x: 0.2, y: 1.1, z: -0.1 };
    const lamp = { x: 1.5, y: 2.4, z: -2.5 };
    const hit = Math.hypot(lamp.x - origin.x, lamp.y - origin.y, lamp.z - origin.z);
    const { events } = run([
      [controller({ grip: origin, ray: rayTowards(INBOX.position, origin), selecting: true })],
      [controller({ grip: origin, ray: rayTowards(lamp, origin), hitDistance: hit })],
      [controller({ grip: origin, ray: rayTowards(lamp, origin), hitDistance: hit, holding: true })],
      [controller({ grip: origin, ray: rayTowards(lamp, origin), hitDistance: hit, selecting: true })],
    ]);
    expect(events.map((event) => event.kind)).toEqual(['grabbed', 'placed']);
  });
});
