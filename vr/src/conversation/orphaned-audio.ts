/**
 * Clearing away what the SDK leaves behind when a connection drops.
 *
 * The SDK plays Jarvis through a hidden `<audio>` element it appends to the page, and removes it
 * when a conversation is closed properly. But `WebRTCConnection.close()` only cleans up while it
 * still counts itself connected — and when the room has already gone, as it has when the network
 * drops or the server closes it, it does not, so the element stays, holding a stream whose tracks
 * have all ended. A phone screen is thrown away before that matters; the headset's page stays open
 * for hours of summonings, and each dropped call would leave one more.
 *
 * Only elements whose every track has ended are touched, so a conversation that is still playing —
 * or anything else on the page with a live stream — is never cut off, and an element playing a
 * file rather than a stream (the greeting's) has no tracks to judge by and is left alone.
 */

/** As much of a media element as deciding and removing takes. `HTMLAudioElement` has it all. */
export interface OrphanCandidate {
  srcObject: unknown;
  pause(): void;
  remove(): void;
}

/** Whether a track is one that will never play again. */
function hasEnded(track: unknown): boolean {
  return typeof track === 'object' && track !== null && Reflect.get(track, 'readyState') === 'ended';
}

/** The tracks of a `MediaStream`, read structurally; none for anything that is not one. */
function tracksOf(stream: unknown): unknown[] {
  if (typeof stream !== 'object' || stream === null) {
    return [];
  }
  const getTracks: unknown = Reflect.get(stream, 'getTracks');
  if (typeof getTracks !== 'function') {
    return [];
  }
  const tracks: unknown = Reflect.apply(getTracks, stream, []);
  return Array.isArray(tracks) ? tracks : [];
}

/** Whether an element is playing a stream that has ended in every track. */
export function isOrphaned(element: OrphanCandidate): boolean {
  const tracks = tracksOf(element.srcObject);
  return tracks.length > 0 && tracks.every(hasEnded);
}

/** Stops and removes every orphaned element among `elements`, and says how many there were. */
export function removeOrphanedAudio(elements: Iterable<OrphanCandidate>): number {
  let removed = 0;
  for (const element of Array.from(elements)) {
    if (!isOrphaned(element)) {
      continue;
    }
    element.pause();
    element.srcObject = null;
    element.remove();
    removed++;
  }
  return removed;
}

/** The same, over every `<audio>` on the page. Nothing to do where there is no page. */
export function removeOrphanedAudioFromPage(): void {
  if (typeof document === 'undefined') {
    return;
  }
  removeOrphanedAudio(document.querySelectorAll('audio'));
}
