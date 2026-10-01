/**
 * Asking the headset for the room.
 *
 * `immersive-ar` is passthrough: the page draws on a transparent layer over the camera view of
 * the user's own room. Only `local-floor` is required, because a required feature the browser
 * lacks, or the user declines, fails the whole request — and Jarvis can still be put in front
 * of someone with none of the rest. Everything that describes the room is optional, and the
 * code that uses it reads `session.enabledFeatures` rather than assuming it was granted: Quest 2
 * and Pro have no meshes, and the spatial permission can be refused.
 */

/** Everything the app can use about the room, none of it essential. */
export const OPTIONAL_ROOM_FEATURES = [
  // Walls, floor, tables and so on as flat polygons, from the headset's Space Setup.
  'plane-detection',
  // Furniture as boxes and the whole room as one triangle mesh; Quest 3 and 3S only.
  'mesh-detection',
  // Keeps him where he was put while the headset's idea of the room shifts.
  'anchors',
  // Depth along a ray, which on Quest 3 comes from the depth sensor with no room scan.
  'hit-test',
  // Pinching is how a hand without a controller summons and dismisses him.
  'hand-tracking',
  // Lets three render into a projection layer, which is what Quest composites fastest.
  'layers',
];

export const ROOM_SESSION_INIT: XRSessionInit = {
  requiredFeatures: ['local-floor'],
  optionalFeatures: OPTIONAL_ROOM_FEATURES,
};

/**
 * Whether this browser can put anything in the room at all.
 *
 * False rather than an error when there is no WebXR: a desktop browser opening the page is
 * expected, and the page says what to open it in instead.
 */
export async function canEnterRoom(xr: XRSystem | undefined): Promise<boolean> {
  if (xr === undefined) return false;
  try {
    return await xr.isSessionSupported('immersive-ar');
  } catch {
    return false;
  }
}

/**
 * Starts the passthrough session.
 *
 * Must be called straight from the click that asked for it, before anything is awaited: an
 * immersive session needs the transient activation that click carries, and it expires.
 */
export function requestRoomSession(xr: XRSystem): Promise<XRSession> {
  return xr.requestSession('immersive-ar', ROOM_SESSION_INIT);
}
