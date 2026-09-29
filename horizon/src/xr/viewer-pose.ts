import { Quaternion, Vector3 } from 'three';

/**
 * The head, as one point between the eyes.
 *
 * Read from `frame.getViewerPose` at the start of each frame rather than from three's XR
 * camera, which is updated from the previous frame's pose and so lags one behind. The viewer
 * pose's own transform is the centre eye: the midpoint the per-eye views are offset from. Both
 * eyes see the hologram turned to face this one point, so they agree on what they see.
 */
export interface CentreEye {
  position: Vector3;
  orientation: Quaternion;
}

/** The centre eye of a viewer pose already read for this frame. */
export function centreEyeOfPose(pose: XRPose): CentreEye {
  const { position, orientation } = pose.transform;
  return {
    position: new Vector3(position.x, position.y, position.z),
    orientation: new Quaternion(orientation.x, orientation.y, orientation.z, orientation.w),
  };
}

/** The viewer's centre eye in `space`, or null on the frames the headset has lost track of itself. */
export function centreEyeOf(frame: XRFrame, space: XRReferenceSpace): CentreEye | null {
  const pose = frame.getViewerPose(space);
  return pose === undefined ? null : centreEyeOfPose(pose);
}

/** Which way the head is looking: the unit direction of the centre eye's −Z. */
export function gazeOf(head: CentreEye): Vector3 {
  return new Vector3(0, 0, -1).applyQuaternion(head.orientation);
}

/**
 * The point `distance` metres straight ahead of the head, at the height of the eyes.
 *
 * Ahead along the floor, not along the gaze: someone looking down at their phone when they walk
 * into the room should find him in front of them, not in the carpet. When the gaze is so close
 * to vertical that it has no direction along the floor, the top of the head says which way the
 * face is turned: looking down, it points ahead; looking up, it points back, so ahead is the
 * other way — which for someone lying on their back is towards their feet.
 */
export function pointAhead(head: CentreEye, distance: number): Vector3 {
  const gaze = gazeOf(head);
  const ahead = new Vector3(gaze.x, 0, gaze.z);
  if (ahead.lengthSq() < 1e-6) {
    const top = new Vector3(0, 1, 0).applyQuaternion(head.orientation);
    ahead.set(top.x, 0, top.z).multiplyScalar(gaze.y < 0 ? 1 : -1);
  }
  ahead.normalize();
  return head.position.clone().addScaledVector(ahead, distance);
}
