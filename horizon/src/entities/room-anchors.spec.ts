import { describe, expect, it } from 'bun:test';
import { poseFromQuaternion, toReference } from '../room/pose-matrix';
import type { Vector3Like } from '../xr/ray';
import { EMPTY_REGISTRY, type EntityRegistry, placeEntity, recordEntities, rememberAnchor } from './registry';
import {
  ANCHOR_REUSE_METRES,
  createRoomAnchors,
  type DropResult,
  MAX_ROOM_ANCHORS,
  NOT_FOUND_AFTER_SECONDS,
  type PersistentAnchorLike,
  type PersistentAnchorSession,
  type RoomAnchorFrame,
} from './room-anchors';

/**
 * Whether WebXR's own session and frame fit what the keeper asks of them, as they are. Checked by
 * the typechecker, which runs over this file with the rest of the app: if a new `@types/webxr` stops
 * fitting, `true` stops being assignable here and the build fails.
 */
type WebXrFits =
  XRSession extends PersistentAnchorSession<XRSpace>
    ? XRFrame extends RoomAnchorFrame<XRSpace, XRRigidTransform>
      ? true
      : false
    : false;
const webXrFits: WebXrFits = true;

/** An anchor whose space is a name, and whose persistent handle the test grants or refuses. */
class FakeAnchor implements PersistentAnchorLike<string> {
  deleted = false;
  handle?: { resolve: (uuid: string) => void; reject: () => void };
  requestPersistentHandle?: () => Promise<string> = () =>
    new Promise<string>((resolve, reject) => {
      this.handle = { resolve, reject: () => reject(new Error('limit reached')) };
    });
  constructor(readonly anchorSpace: string) {}
  delete() {
    this.deleted = true;
  }
}

/** A session with the handles it lists, restoring each when the test says so. */
class FakeSession implements PersistentAnchorSession<string> {
  readonly restoring = new Map<string, { resolve: (anchor: FakeAnchor) => void; reject: () => void }>();
  readonly deleted: string[] = [];
  constructor(readonly persistentAnchors: string[]) {}
  restorePersistentAnchor = (uuid: string) =>
    new Promise<PersistentAnchorLike<string>>((resolve, reject) => {
      this.restoring.set(uuid, { resolve, reject: () => reject(new Error('InvalidStateError')) });
    });
  deletePersistentAnchor = async (uuid: string) => {
    this.deleted.push(uuid);
  };
}

/** A frame whose anchors are wherever the test says, and whose new anchors wait for the test. */
class FakeFrame implements RoomAnchorFrame<string, Vector3Like> {
  readonly poses = new Map<string, Float32Array>();
  readonly created: { at: Vector3Like; resolve: (anchor: FakeAnchor) => void; reject: () => void }[] = [];
  createAnchor?: (pose: Vector3Like, space: string) => Promise<PersistentAnchorLike<string>> = (at, space) => {
    expect(space).toBe('local-floor');
    return new Promise((resolve, reject) => {
      this.created.push({ at, resolve, reject: () => reject(new Error('refused')) });
    });
  };
  getPose(space: string, baseSpace: string) {
    expect(baseSpace).toBe('local-floor');
    const matrix = this.poses.get(space);
    return matrix === undefined ? undefined : { transform: { matrix } };
  }
}

/** Lets every settled promise's callbacks run. */
async function settle() {
  for (let round = 0; round < 5; round++) await Promise.resolve();
}

const LEVEL = { x: 0, y: 0, z: 0, w: 1 };
/** A quarter turn about the vertical. */
const QUARTER_TURN = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';

function registryWith(anchors: string[]): EntityRegistry {
  let registry = recordEntities(EMPTY_REGISTRY, [{ id: 'light.kitchen' }, { id: 'inbox:work' }], 1);
  for (const anchor of anchors) registry = rememberAnchor(registry, anchor, 1);
  return registry;
}

/** A keeper with anchors `uuids` restored and located at `poses`. */
async function restored(uuids: string[], poses: Float32Array[]) {
  const session = new FakeSession(uuids);
  const anchors = createRoomAnchors<string, Vector3Like>(session, (position) => ({ ...position }));
  const registry = registryWith(uuids);
  expect(anchors.restore(registry, 0)).toEqual([]);
  const frame = new FakeFrame();
  uuids.forEach((uuid, index) => {
    session.restoring.get(uuid)?.resolve(new FakeAnchor(`space-${uuid}`));
    const pose = poses[index];
    if (pose !== undefined) frame.poses.set(`space-${uuid}`, pose);
  });
  await settle();
  anchors.update(frame, 'local-floor', 0);
  return { session, anchors, registry, frame };
}

function expectPoint(actual: Vector3Like | undefined, expected: Vector3Like) {
  expect(actual?.x).toBeCloseTo(expected.x, 5);
  expect(actual?.y).toBeCloseTo(expected.y, 5);
  expect(actual?.z).toBeCloseTo(expected.z, 5);
}

describe('restoring', () => {
  it('restores the handles the headset lists, and gives back the ones it does not', async () => {
    const session = new FakeSession([A]);
    const anchors = createRoomAnchors<string, Vector3Like>(session, (position) => ({ ...position }));
    expect(anchors.restore(registryWith([A, B]), 0)).toEqual([B]);
    expect([...session.restoring.keys()]).toEqual([A]);
    expect(anchors.status(0).anchors).toEqual({ [A]: 'restoring', [B]: 'missing' });
  });

  it('follows a restored anchor from unlocated to located and back', async () => {
    const session = new FakeSession([A]);
    const anchors = createRoomAnchors<string, Vector3Like>(session, (position) => ({ ...position }));
    anchors.restore(registryWith([A]), 0);
    session.restoring.get(A)?.resolve(new FakeAnchor('space-a'));
    await settle();
    const frame = new FakeFrame();
    anchors.update(frame, 'local-floor', 1);
    expect(anchors.status(1).anchors[A]).toBe('unlocated');
    frame.poses.set('space-a', poseFromQuaternion({ x: 1, y: 0, z: -2 }, LEVEL));
    anchors.update(frame, 'local-floor', 2);
    expect(anchors.status(2).anchors[A]).toBe('located');
    frame.poses.delete('space-a');
    anchors.update(frame, 'local-floor', 3);
    expect(anchors.status(3).anchors[A]).toBe('unlocated');
  });

  it('says so when the headset will not restore one', async () => {
    const session = new FakeSession([A]);
    const anchors = createRoomAnchors<string, Vector3Like>(session, (position) => ({ ...position }));
    anchors.restore(registryWith([A]), 0);
    session.restoring.get(A)?.reject();
    await settle();
    expect(anchors.status(0).anchors[A]).toBe('failed');
  });

  it('forgets nothing on a session with no persistent anchors, which may only lack the feature', () => {
    const anchors = createRoomAnchors<string, Vector3Like>({}, (position) => ({ ...position }));
    expect(anchors.restore(registryWith([A]), 0)).toEqual([]);
    expect(anchors.status(0).anchors).toEqual({ [A]: 'unsupported' });
  });

  it(`counts an anchor never located in ${NOT_FOUND_AFTER_SECONDS} s as not found in this room`, async () => {
    const session = new FakeSession([A]);
    const anchors = createRoomAnchors<string, Vector3Like>(session, (position) => ({ ...position }));
    anchors.restore(registryWith([A]), 100);
    expect(anchors.status(100 + NOT_FOUND_AFTER_SECONDS - 1).notFound).toEqual([]);
    expect(anchors.status(100 + NOT_FOUND_AFTER_SECONDS).notFound).toEqual([A]);
  });

  it('never counts an anchor located once as not found', async () => {
    const { anchors, frame } = await restored([A], [poseFromQuaternion({ x: 0, y: 0, z: 0 }, LEVEL)]);
    frame.poses.clear();
    anchors.update(frame, 'local-floor', 30);
    expect(anchors.status(30).notFound).toEqual([]);
  });

  it('gives back an anchor released while it was being restored', async () => {
    const session = new FakeSession([A]);
    const anchors = createRoomAnchors<string, Vector3Like>(session, (position) => ({ ...position }));
    anchors.restore(registryWith([A]), 0);
    anchors.release([A]);
    const anchor = new FakeAnchor('space-a');
    session.restoring.get(A)?.resolve(anchor);
    await settle();
    expect(anchor.deleted).toBe(true);
    expect(session.deleted).toEqual([A]);
    expect(anchors.status(0).anchors).toEqual({});
  });
});

describe('dropping near an anchor', () => {
  it(`uses a located anchor within ${ANCHOR_REUSE_METRES} m, with the offset in its own space`, async () => {
    const pose = poseFromQuaternion({ x: 1, y: 0, z: -2 }, QUARTER_TURN);
    const { anchors, registry, frame } = await restored([A], [pose]);
    const point = { x: 2, y: 1.5, z: -3 };
    const result = anchors.drop(frame, 'local-floor', 'light.kitchen', point, registry, 1);
    if (result.kind !== 'placed') throw new Error(`Expected a placement, got ${result.kind}.`);
    expect(result.anchor).toBe(A);
    // A quarter turn about y takes the anchor's +x to the reference space's −z.
    expectPoint({ x: result.offset[0], y: result.offset[1], z: result.offset[2] }, { x: 1, y: 1.5, z: 1 });
    expectPoint(anchors.positionOf({ anchor: A, offset: result.offset, placedAt: 1 }), point);
    expect(frame.created).toEqual([]);
  });

  it('keeps an entity at the same spot in the room when the next session starts somewhere else', async () => {
    // This session: the anchor where it was made; next session: the whole room turned and shifted
    // in the new local-floor, anchor and lamp alike.
    const first = await restored([A], [poseFromQuaternion({ x: 0.5, y: 0, z: -1 }, LEVEL)]);
    const lamp = { x: 1.2, y: 1.9, z: -1.8 };
    const result = first.anchors.drop(first.frame, 'local-floor', 'light.kitchen', lamp, first.registry, 1);
    if (result.kind !== 'placed') throw new Error(`Expected a placement, got ${result.kind}.`);
    const registry = placeEntity(first.registry, 'light.kitchen', result.anchor, result.offset, 1);
    const placement = registry.entities['light.kitchen']?.placement;
    if (placement === undefined) throw new Error('Nothing was placed.');

    const moved = poseFromQuaternion({ x: -3, y: 0, z: 4 }, QUARTER_TURN);
    const anchorNextTime = toReference(moved, 0.5, 0, -1);
    const lampNextTime = toReference(moved, lamp.x, lamp.y, lamp.z);
    const turnedAnchor = poseFromQuaternion(anchorNextTime, QUARTER_TURN);
    const second = await restored([A], [turnedAnchor]);
    expectPoint(second.anchors.positionOf(placement), lampNextTime);
  });

  it('has no position for a placement whose anchor is not located', async () => {
    const { anchors, frame } = await restored([A], [poseFromQuaternion({ x: 0, y: 0, z: 0 }, LEVEL)]);
    expect(anchors.positionOf({ anchor: B, offset: [0, 0, 0], placedAt: 0 })).toBeUndefined();
    frame.poses.clear();
    anchors.update(frame, 'local-floor', 1);
    expect(anchors.positionOf({ anchor: A, offset: [0, 0, 0], placedAt: 0 })).toBeUndefined();
  });
});

describe('dropping far from every anchor', () => {
  async function farDrop() {
    const setup = await restored([A], [poseFromQuaternion({ x: 0, y: 0, z: 0 }, LEVEL)]);
    const point = { x: 0, y: 2.2, z: -4 };
    const result = setup.anchors.drop(setup.frame, 'local-floor', 'light.kitchen', point, setup.registry, 5);
    return { ...setup, point, result };
  }

  it('asks for a new anchor at the spot, and stands the entity there meanwhile', async () => {
    const { anchors, frame, point, result } = await farDrop();
    expect(result).toEqual({ kind: 'pending', id: 'light.kitchen' });
    expect(frame.created.map((request) => request.at)).toEqual([point]);
    expect(anchors.pendingDrops()).toEqual([{ id: 'light.kitchen', position: point }]);
    expect(anchors.status(5).pending).toBe(1);
  });

  it('settles on the new anchor once it has a handle and is located', async () => {
    const { anchors, frame, point } = await farDrop();
    const anchor = new FakeAnchor('space-new');
    frame.created[0]?.resolve(anchor);
    await settle();
    expect(anchors.update(frame, 'local-floor', 6)).toEqual([]);
    anchor.handle?.resolve(B);
    await settle();
    // Handed out but not yet located: still waiting.
    expect(anchors.update(frame, 'local-floor', 6)).toEqual([]);
    frame.poses.set('space-new', poseFromQuaternion(point, LEVEL));
    const settled = anchors.update(frame, 'local-floor', 7);
    expect(settled).toHaveLength(1);
    const [placed] = settled;
    if (placed?.kind !== 'placed') throw new Error('Expected a placement.');
    expect(placed.anchor).toBe(B);
    expectPoint({ x: placed.offset[0], y: placed.offset[1], z: placed.offset[2] }, { x: 0, y: 0, z: 0 });
    expect(anchors.pendingDrops()).toEqual([]);
    expect(anchors.status(7).anchors[B]).toBe('located');
  });

  it('falls back to the nearest located anchor when the headset will not keep another', async () => {
    const { anchors, frame, point } = await farDrop();
    const anchor = new FakeAnchor('space-new');
    frame.created[0]?.resolve(anchor);
    await settle();
    anchor.handle?.reject();
    await settle();
    expect(anchor.deleted).toBe(true);
    const [placed] = anchors.update(frame, 'local-floor', 6);
    if (placed?.kind !== 'placed') throw new Error('Expected a placement.');
    expect(placed.anchor).toBe(A);
    expectPoint({ x: placed.offset[0], y: placed.offset[1], z: placed.offset[2] }, point);
  });

  it('falls back when the anchor cannot be made persistent at all', async () => {
    const { anchors, frame } = await farDrop();
    const anchor = new FakeAnchor('space-new');
    anchor.requestPersistentHandle = undefined;
    frame.created[0]?.resolve(anchor);
    await settle();
    expect(anchor.deleted).toBe(true);
    expect(anchors.update(frame, 'local-floor', 6)[0]).toMatchObject({ kind: 'placed', anchor: A });
  });

  it('falls back when the spot cannot be anchored', async () => {
    const { anchors, frame } = await farDrop();
    frame.created[0]?.reject();
    await settle();
    expect(anchors.update(frame, 'local-floor', 6)[0]).toMatchObject({ kind: 'placed', anchor: A });
  });

  it(`falls back when the new anchor is not located within ${NOT_FOUND_AFTER_SECONDS} s`, async () => {
    const { anchors, frame } = await farDrop();
    const anchor = new FakeAnchor('space-new');
    frame.created[0]?.resolve(anchor);
    await settle();
    anchor.handle?.resolve(B);
    await settle();
    expect(anchors.update(frame, 'local-floor', 5 + NOT_FOUND_AFTER_SECONDS - 1)).toEqual([]);
    expect(anchors.update(frame, 'local-floor', 5 + NOT_FOUND_AFTER_SECONDS)[0]).toMatchObject({
      kind: 'placed',
      anchor: A,
    });
  });

  it('fails when nothing can be anchored and no anchor is located here', async () => {
    const session = new FakeSession([]);
    const anchors = createRoomAnchors<string, Vector3Like>(session, (position) => ({ ...position }));
    const frame = new FakeFrame();
    frame.createAnchor = undefined;
    const result: DropResult = anchors.drop(
      frame,
      'local-floor',
      'inbox:work',
      { x: 0, y: 1, z: -1 },
      registryWith([]),
      0,
    );
    expect(result.kind).toBe('pending');
    const [settled] = anchors.update(frame, 'local-floor', 0);
    expect(settled).toMatchObject({ kind: 'failed', id: 'inbox:work' });
  });

  it('gives back the new anchor of a drop replaced while it was being made', async () => {
    const { anchors, frame, session, registry } = await farDrop();
    anchors.drop(frame, 'local-floor', 'light.kitchen', { x: 0.2, y: 0.5, z: 0.3 }, registry, 6);
    expect(anchors.pendingDrops()).toEqual([]);
    const anchor = new FakeAnchor('space-new');
    frame.created[0]?.resolve(anchor);
    await settle();
    anchor.handle?.resolve(B);
    await settle();
    expect(session.deleted).toEqual([B]);
    expect(anchor.deleted).toBe(true);
  });
});

describe('the anchor budget', () => {
  const uuids = Array.from({ length: MAX_ROOM_ANCHORS }, (_, index) => `cccccccc-0000-4000-8000-00000000000${index}`);

  it(`makes no anchor past ${MAX_ROOM_ANCHORS}, and uses the nearest located one however far`, async () => {
    const poses = uuids.map((_, index) => poseFromQuaternion({ x: index * 10, y: 0, z: 0 }, LEVEL));
    const { anchors, frame, registry } = await restored(uuids, poses);
    const result = anchors.drop(frame, 'local-floor', 'light.kitchen', { x: 26, y: 0, z: 5 }, registry, 1);
    expect(frame.created).toEqual([]);
    expect(result).toMatchObject({ kind: 'placed', anchor: uuids[3] });
  });

  it('fails past the budget when none of the anchors is in this room', async () => {
    const { anchors, frame, registry } = await restored(uuids, []);
    const result = anchors.drop(frame, 'local-floor', 'light.kitchen', { x: 0, y: 0, z: 0 }, registry, 1);
    expect(result.kind).toBe('failed');
  });

  it('counts anchors being made against the budget', async () => {
    const first = uuids.slice(0, MAX_ROOM_ANCHORS - 1);
    const { anchors, frame, registry } = await restored(first, [poseFromQuaternion({ x: 0, y: 0, z: 0 }, LEVEL)]);
    expect(anchors.drop(frame, 'local-floor', 'light.kitchen', { x: 10, y: 0, z: 0 }, registry, 1).kind).toBe(
      'pending',
    );
    expect(anchors.drop(frame, 'local-floor', 'inbox:work', { x: -10, y: 0, z: 0 }, registry, 1).kind).toBe('placed');
    expect(frame.created).toHaveLength(1);
  });

  it('does not count a handle the headset no longer has', async () => {
    const session = new FakeSession([]);
    const anchors = createRoomAnchors<string, Vector3Like>(session, (position) => ({ ...position }));
    const registry = registryWith(uuids);
    expect(anchors.restore(registry, 0)).toEqual(uuids);
    const frame = new FakeFrame();
    anchors.update(frame, 'local-floor', 0);
    expect(anchors.drop(frame, 'local-floor', 'light.kitchen', { x: 0, y: 0, z: 0 }, registry, 1).kind).toBe('pending');
  });
});

describe("WebXR's own types", () => {
  it('fit the session and the frame the keeper asks for', () => {
    expect(webXrFits).toBe(true);
  });
});

describe('release', () => {
  it('gives back the persistent handle and stops following the anchor', async () => {
    const { anchors, session, frame } = await restored([A], [poseFromQuaternion({ x: 0, y: 0, z: 0 }, LEVEL)]);
    anchors.release([A]);
    expect(session.deleted).toEqual([A]);
    anchors.update(frame, 'local-floor', 1);
    expect(anchors.positionOf({ anchor: A, offset: [0, 0, 0], placedAt: 0 })).toBeUndefined();
    expect(anchors.status(1).anchors).toEqual({});
  });
});
