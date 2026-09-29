import { describe, expect, it } from 'bun:test';
import { Euler, Quaternion, Vector3 } from 'three';
import { pointAhead } from './viewer-pose';

/** A head at standing height, turned `yaw` radians left of -Z and tilted `pitch` radians up. */
function head(yaw: number, pitch: number) {
  return {
    position: new Vector3(0.5, 1.6, -0.25),
    orientation: new Quaternion().setFromEuler(new Euler(pitch, yaw, 0, 'YXZ')),
  };
}

function expectClose(actual: Vector3, expected: Vector3) {
  expect(actual.distanceTo(expected)).toBeLessThan(1e-9);
}

describe('pointAhead', () => {
  it('is the given distance straight ahead, at eye height', () => {
    expectClose(pointAhead(head(0, 0), 1.6), new Vector3(0.5, 1.6, -1.85));
  });

  it('turns with the head', () => {
    // A quarter turn left faces -X.
    expectClose(pointAhead(head(Math.PI / 2, 0), 2), new Vector3(-1.5, 1.6, -0.25));
  });

  it('goes along the floor rather than along a lowered or raised gaze', () => {
    for (const pitch of [-1.2, -0.5, 0.5, 1.2]) {
      expectClose(pointAhead(head(0, pitch), 1.6), new Vector3(0.5, 1.6, -1.85));
    }
  });

  it('still picks the way the face is turned when looking straight down or straight up', () => {
    expectClose(pointAhead(head(0, -Math.PI / 2), 1), new Vector3(0.5, 1.6, -1.25));
    // Looking straight up, the top of the head points back, so ahead is the other way.
    expectClose(pointAhead(head(0, Math.PI / 2), 1), new Vector3(0.5, 1.6, -1.25));
  });
});
