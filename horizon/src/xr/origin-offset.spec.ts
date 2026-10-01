import { describe, expect, it } from 'bun:test';
import { originPose, parseOriginOffset } from './origin-offset';
import { rotate } from './ray';

describe('parseOriginOffset', () => {
  it('reads x, z and a yaw in degrees', () => {
    expect(parseOriginOffset('0.8,-0.5,30')).toEqual({ x: 0.8, z: -0.5, yawDegrees: 30 });
    expect(parseOriginOffset(' 1 , 2 , -90 ')).toEqual({ x: 1, z: 2, yawDegrees: -90 });
  });

  it('asks for nothing when the parameter is absent or does not read', () => {
    expect(parseOriginOffset(null)).toBeUndefined();
    expect(parseOriginOffset('')).toBeUndefined();
    expect(parseOriginOffset('1,2')).toBeUndefined();
    expect(parseOriginOffset('1,,2')).toBeUndefined();
    expect(parseOriginOffset('1,2,3,4')).toBeUndefined();
    expect(parseOriginOffset('a,2,3')).toBeUndefined();
    expect(parseOriginOffset('1e9,0,0')).toBeUndefined();
  });
});

describe('originPose', () => {
  it('stands the origin on the floor and turns it about the vertical', () => {
    const pose = originPose({ x: 1, z: -2, yawDegrees: 90 });
    expect(pose.position).toEqual({ x: 1, y: 0, z: -2 });
    // Turned anticlockwise seen from above: the room's −Z, its forward, becomes the headset's −X.
    const forward = rotate({ x: 0, y: 0, z: -1 }, pose.orientation);
    expect(forward.x).toBeCloseTo(-1, 6);
    expect(forward.y).toBeCloseTo(0, 6);
    expect(forward.z).toBeCloseTo(0, 6);
  });

  it('is no turn at all for a yaw of zero', () => {
    expect(originPose({ x: 0, z: 0, yawDegrees: 0 }).orientation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });
});
