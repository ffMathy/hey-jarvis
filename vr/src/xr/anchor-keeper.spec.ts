import { describe, expect, it } from 'bun:test';
import { type AnchorFrame, type AnchorLike, createAnchorKeeper } from './anchor-keeper';
import type { Vector3Like } from './ray';

/** An anchor the test can move, and can see deleted. */
class FakeAnchor implements AnchorLike<string> {
  deleted = false;
  constructor(
    readonly anchorSpace: string,
    public position: Vector3Like | undefined,
  ) {}
  delete() {
    this.deleted = true;
  }
}

/** A frame whose anchors resolve only when the test says so. */
class FakeFrame implements AnchorFrame<string, Vector3Like> {
  readonly requests: { transform: Vector3Like; resolve: (anchor: FakeAnchor) => void; reject: () => void }[] = [];
  readonly anchors = new Map<string, FakeAnchor>();

  createAnchor = (transform: Vector3Like, space: string) => {
    expect(space).toBe('local-floor');
    return new Promise<AnchorLike<string>>((resolve, reject) => {
      this.requests.push({ transform, resolve, reject: () => reject(new Error('refused')) });
    });
  };

  getPose(space: string) {
    const position = this.anchors.get(space)?.position;
    return position === undefined ? undefined : { transform: { position } };
  }

  /** Resolves request `index` with an anchor currently at `position`. */
  async grant(index: number, position: Vector3Like): Promise<FakeAnchor> {
    const anchor = new FakeAnchor(`anchor-${index}`, position);
    this.anchors.set(anchor.anchorSpace, anchor);
    this.requests[index]?.resolve(anchor);
    await Promise.resolve();
    await Promise.resolve();
    return anchor;
  }
}

function keeper() {
  return createAnchorKeeper<string, Vector3Like>((position) => ({ ...position }));
}

const SPOT = { x: 0, y: 1.45, z: -1.6 };

describe('createAnchorKeeper', () => {
  it('has no spot until one is placed', () => {
    expect(keeper().where(new FakeFrame(), 'local-floor')).toBeUndefined();
  });

  it('stands him at the placed spot at once, and asks for an anchor there', () => {
    const frame = new FakeFrame();
    const anchors = keeper();
    anchors.place(frame, 'local-floor', SPOT);
    expect(anchors.where(frame, 'local-floor')).toEqual(SPOT);
    expect(frame.requests.map((request) => request.transform)).toEqual([SPOT]);
  });

  it('follows the anchor once it resolves', async () => {
    const frame = new FakeFrame();
    const anchors = keeper();
    anchors.place(frame, 'local-floor', SPOT);
    const anchor = await frame.grant(0, SPOT);
    anchor.position = { x: 0.02, y: 1.45, z: -1.58 };
    expect(anchors.where(frame, 'local-floor')).toEqual({ x: 0.02, y: 1.45, z: -1.58 });
  });

  it('keeps him where the anchor last was on a frame it is not tracked in', async () => {
    const frame = new FakeFrame();
    const anchors = keeper();
    anchors.place(frame, 'local-floor', SPOT);
    const anchor = await frame.grant(0, { x: 0.1, y: 1.45, z: -1.6 });
    anchors.where(frame, 'local-floor');
    anchor.position = undefined;
    expect(anchors.where(frame, 'local-floor')).toEqual({ x: 0.1, y: 1.45, z: -1.6 });
  });

  it('deletes the old anchor as soon as he has a new spot', async () => {
    const frame = new FakeFrame();
    const anchors = keeper();
    anchors.place(frame, 'local-floor', SPOT);
    const first = await frame.grant(0, SPOT);
    anchors.place(frame, 'local-floor', { x: 1, y: 1.2, z: -1 });
    expect(first.deleted).toBe(true);
    expect(anchors.where(frame, 'local-floor')).toEqual({ x: 1, y: 1.2, z: -1 });
  });

  it('deletes an anchor that arrives for a spot he has already left', async () => {
    const frame = new FakeFrame();
    const anchors = keeper();
    anchors.place(frame, 'local-floor', SPOT);
    anchors.place(frame, 'local-floor', { x: 1, y: 1.2, z: -1 });
    const late = await frame.grant(0, SPOT);
    expect(late.deleted).toBe(true);
    expect(anchors.where(frame, 'local-floor')).toEqual({ x: 1, y: 1.2, z: -1 });
    const current = await frame.grant(1, { x: 1, y: 1.2, z: -1 });
    expect(current.deleted).toBe(false);
  });

  it('deletes everything on clear, including an anchor still on its way', async () => {
    const frame = new FakeFrame();
    const anchors = keeper();
    anchors.place(frame, 'local-floor', SPOT);
    anchors.clear();
    expect(anchors.where(frame, 'local-floor')).toBeUndefined();
    expect((await frame.grant(0, SPOT)).deleted).toBe(true);
  });

  it('stands him at the spot all the same when anchors are refused or missing', async () => {
    const frame = new FakeFrame();
    const anchors = keeper();
    anchors.place(frame, 'local-floor', SPOT);
    frame.requests[0]?.reject();
    await Promise.resolve();
    expect(anchors.where(frame, 'local-floor')).toEqual(SPOT);

    const withoutAnchors: AnchorFrame<string, Vector3Like> = { getPose: () => undefined };
    anchors.place(withoutAnchors, 'local-floor', { x: 2, y: 1, z: 0 });
    expect(anchors.where(withoutAnchors, 'local-floor')).toEqual({ x: 2, y: 1, z: 0 });
  });

  it('stands him at the spot when asking for an anchor throws', () => {
    const throwing: AnchorFrame<string, Vector3Like> = {
      createAnchor: () => {
        throw new Error('The frame is not active.');
      },
      getPose: () => undefined,
    };
    const anchors = keeper();
    anchors.place(throwing, 'local-floor', SPOT);
    expect(anchors.where(throwing, 'local-floor')).toEqual(SPOT);
  });
});
