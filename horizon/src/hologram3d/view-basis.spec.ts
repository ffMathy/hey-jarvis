import { describe, expect, it } from 'bun:test';
import { FRONT_VIEW, type Vector3Tuple, type ViewBasis } from './fragment-3d';
import { bodyFrame, closeRangeFade, frontTowards, inFrame, viewBasisTowards } from './view-basis';

function dot(first: Vector3Tuple, second: Vector3Tuple) {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function cross(first: Vector3Tuple, second: Vector3Tuple): Vector3Tuple {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function expectVector(actual: Vector3Tuple, expected: Vector3Tuple) {
  actual.forEach((value, axis) => {
    expect(value).toBeCloseTo(expected[axis], 9);
  });
}

/** Unit length, square to each other, and right-handed: right × up = front. */
function expectRightHanded(basis: ViewBasis) {
  for (const vector of [basis.right, basis.up, basis.front]) expect(dot(vector, vector)).toBeCloseTo(1, 9);
  expect(dot(basis.right, basis.up)).toBeCloseTo(0, 9);
  expect(dot(basis.up, basis.front)).toBeCloseTo(0, 9);
  expectVector(cross(basis.right, basis.up), basis.front);
}

const CENTRE = { x: 0.3, y: 1.4, z: -1.6 };

describe('his front', () => {
  it('faces the head along the floor, whatever the height of either', () => {
    expectVector(frontTowards(CENTRE, { x: 0.3, y: 1.7, z: 0 }), [0, 0, 1]);
    expectVector(frontTowards(CENTRE, { x: 2.3, y: 0.2, z: -1.6 }), [1, 0, 0]);
  });

  it('faces the reference space’s +z when the head is straight above him', () => {
    expectVector(frontTowards(CENTRE, { x: 0.3, y: 3, z: -1.6 }), [0, 0, 1]);
  });

  it('makes a right-handed body frame with the world’s up as its up', () => {
    const frame = bodyFrame(frontTowards(CENTRE, { x: 1.3, y: 1.7, z: -0.6 }));
    expectRightHanded(frame);
    expectVector(frame.up, [0, 1, 0]);
    // Facing the reference space's +z, the body's own frame is the reference space's.
    expect(bodyFrame([0, 0, 1])).toEqual({ right: [1, 0, -0], up: [0, 1, 0], front: [0, 0, 1] });
  });
});

describe('the view plane', () => {
  it('faces the centre eye, keeps the world’s up as near up as it can, and is right-handed', () => {
    const head = { x: 1.2, y: 2.1, z: -0.4 };
    const basis = viewBasisTowards(CENTRE, head, null);
    expectRightHanded(basis);
    const towardsHead: Vector3Tuple = [head.x - CENTRE.x, head.y - CENTRE.y, head.z - CENTRE.z];
    const distance = Math.hypot(...towardsHead);
    expectVector(basis.front, [towardsHead[0] / distance, towardsHead[1] / distance, towardsHead[2] / distance]);
    // Level, as the world's up is: the right never tilts.
    expect(basis.right[1]).toBeCloseTo(0, 9);
    expect(basis.up[1]).toBeGreaterThan(0);
  });

  it('is the phone’s own view when the eye is level and straight in front', () => {
    const basis = viewBasisTowards(CENTRE, { x: CENTRE.x, y: CENTRE.y, z: CENTRE.z + 1.6 }, null);
    expectVector(basis.right, FRONT_VIEW.right);
    expectVector(basis.up, FRONT_VIEW.up);
    expectVector(basis.front, FRONT_VIEW.front);
  });

  it('keeps the last plane when the eye is straight above him or on top of him', () => {
    const previous = viewBasisTowards(CENTRE, { x: 1, y: 1.4, z: 0 }, null);
    expect(viewBasisTowards(CENTRE, { x: CENTRE.x, y: 3, z: CENTRE.z }, previous)).toBe(previous);
    expect(viewBasisTowards(CENTRE, CENTRE, previous)).toBe(previous);
    expect(viewBasisTowards(CENTRE, CENTRE, null)).toBe(FRONT_VIEW);
  });

  it('is expressed in the body’s frame: the front view, seen by a body turned the other way', () => {
    const view = viewBasisTowards(CENTRE, { x: CENTRE.x, y: CENTRE.y, z: CENTRE.z + 2 }, null);
    // A body facing +x sees an eye on its +z side as coming from its left.
    const body = bodyFrame([1, 0, 0]);
    const inBody = inFrame(view, body);
    expectRightHanded(inBody);
    expectVector(inBody.front, [-1, 0, 0]);
    expectVector(inFrame(view, bodyFrame([0, 0, 1])).front, [0, 0, 1]);
  });
});

describe('the close-range fade', () => {
  it('shows him in full from two and a half radii out and not at all inside one and a half', () => {
    expect(closeRangeFade(1.6, 0.22)).toBe(1);
    expect(closeRangeFade(2.5 * 0.22, 0.22)).toBeCloseTo(1, 12);
    expect(closeRangeFade(1.5 * 0.22, 0.22)).toBe(0);
    expect(closeRangeFade(0, 0.22)).toBe(0);
  });

  it('fades smoothly and only one way between', () => {
    let previous = 0;
    for (let share = 1.5; share <= 2.5; share += 0.05) {
      const fade = closeRangeFade(share * 0.22, 0.22);
      expect(fade).toBeGreaterThanOrEqual(previous);
      previous = fade;
    }
    expect(closeRangeFade(2 * 0.22, 0.22)).toBeCloseTo(0.5, 9);
  });
});
