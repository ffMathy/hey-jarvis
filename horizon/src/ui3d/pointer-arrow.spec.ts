import { describe, expect, it } from 'bun:test';
import { Euler, Quaternion } from 'three';
import { IN_VIEW_DEGREES, pointerBearing } from './pointer-arrow';

function eye(yaw = 0, pitch = 0) {
  const { x, y, z, w } = new Quaternion().setFromEuler(new Euler(pitch, yaw, 0, 'YXZ'));
  return { position: { x: 0, y: 1.6, z: 0 }, orientation: { x, y, z, w } };
}

/** A point `distance` ahead of the head at eye level, turned `degrees` to the left. */
function around(degrees: number, distance = 1.6) {
  const radians = (degrees * Math.PI) / 180;
  return { x: -Math.sin(radians) * distance, y: 1.6, z: -Math.cos(radians) * distance };
}

describe('pointerBearing', () => {
  it('needs no arrow for someone in plain view', () => {
    expect(pointerBearing(eye(), around(0)).offView).toBe(false);
    expect(pointerBearing(eye(), around(IN_VIEW_DEGREES - 1)).offView).toBe(false);
  });

  it('points left or right to someone off to the side', () => {
    const left = pointerBearing(eye(), around(50));
    expect(left.offView).toBe(true);
    expect(left.angle).toBeCloseTo(Math.PI, 6);
    const right = pointerBearing(eye(), around(-50));
    expect(right.offView).toBe(true);
    expect(right.angle).toBeCloseTo(0, 6);
  });

  it('points down to someone below a raised gaze', () => {
    const bearing = pointerBearing(eye(0, 0.9), around(0));
    expect(bearing.offView).toBe(true);
    expect(bearing.angle).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('turns with the head', () => {
    // Turned 60° left, someone straight down the room's −Z is 60° to the right.
    const bearing = pointerBearing(eye((60 * Math.PI) / 180), around(0));
    expect(bearing.offView).toBe(true);
    expect(bearing.angle).toBeCloseTo(0, 6);
  });

  it('picks a way round for someone straight behind, and has nothing to say from inside him', () => {
    expect(pointerBearing(eye(), around(180))).toEqual({ offView: true, angle: 0 });
    expect(pointerBearing(eye(), { x: 0, y: 1.6, z: 0 })).toEqual({ offView: false, angle: 0 });
  });
});
