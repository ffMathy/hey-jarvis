import type { Vector3Like } from './ray';

/**
 * How far the real world is in front of the head, right now, along a fan of rays.
 *
 * The room's planes and meshes come from Space Setup, which can be weeks old: the chair moved, a
 * person walked in, the laundry is on the floor. A Quest 3 answers hit tests from its depth sensor
 * instead (Quest Browser 40.4 and later), so a handful of rays fanned out ahead of the viewer say
 * what is actually there this frame, and placement refuses a spot that one of them says is behind
 * something. The rays are created once, in viewer space, so they follow the head with no work per
 * frame beyond reading their results.
 */

/** A depth hit along one ray: which way from the head, and how far to the first surface. */
export interface DepthProbe {
  /** Unit direction from the head, reference space. */
  direction: Vector3Like;
  /** Distance to the nearest surface along it, metres. */
  distance: number;
}

/**
 * The fan, in viewer space (−Z ahead, +Y up): five rays at eye level, a few degrees down, spread
 * across the ±35° cone placement looks in — straight ahead, 15° and 30° to each side.
 */
export const FAN_DIRECTIONS: readonly Vector3Like[] = [0, -15, 15, -30, 30].map((yawDegrees) =>
  directionAt(yawDegrees, -5),
);

/** A unit direction `yawDegrees` to the left of ahead (negative is right) and `pitchDegrees` up. */
function directionAt(yawDegrees: number, pitchDegrees: number): Vector3Like {
  const yaw = (yawDegrees * Math.PI) / 180;
  const pitch = (pitchDegrees * Math.PI) / 180;
  return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
}

/** The probe a hit at `hit` makes, seen from `head`; undefined for a hit at the head itself. */
export function probeFromHit(head: Vector3Like, hit: Vector3Like): DepthProbe | undefined {
  const x = hit.x - head.x;
  const y = hit.y - head.y;
  const z = hit.z - head.z;
  const distance = Math.hypot(x, y, z);
  if (distance < 1e-6) return undefined;
  return { direction: { x: x / distance, y: y / distance, z: z / distance }, distance };
}

export interface DepthProbeFan {
  /** This frame's probes; a ray that hit nothing this frame is simply left out. */
  probes(frame: XRFrame, space: XRReferenceSpace, head: Vector3Like): DepthProbe[];
  dispose(): void;
}

/**
 * The fan for `session`, or undefined when it cannot have one: `hit-test` not granted, or the
 * browser refusing the sources. Nothing depends on it — placement works without depth — so a
 * refusal is an answer, not an error.
 */
export async function createDepthProbeFan(session: XRSession): Promise<DepthProbeFan | undefined> {
  const request = session.requestHitTestSource;
  if (!session.enabledFeatures?.includes('hit-test') || request === undefined) return undefined;
  try {
    const viewer = await session.requestReferenceSpace('viewer');
    const requests = FAN_DIRECTIONS.map((direction) =>
      request.call(session, {
        space: viewer,
        offsetRay: new XRRay({ x: 0, y: 0, z: 0, w: 1 }, { ...direction, w: 0 }),
      }),
    );
    const sources = await Promise.all(requests);
    const usable = sources.filter((source) => source !== undefined);
    if (usable.length === 0) return undefined;
    return {
      probes(frame, space, head) {
        const probes: DepthProbe[] = [];
        for (const source of usable) {
          const pose = frame.getHitTestResults(source)[0]?.getPose(space);
          const probe = pose === undefined ? undefined : probeFromHit(head, pose.transform.position);
          if (probe !== undefined) probes.push(probe);
        }
        return probes;
      },
      dispose() {
        for (const source of usable) source.cancel();
      },
    };
  } catch {
    return undefined;
  }
}
