/**
 * Which echo canceller the headset's microphone has, read from the wake word's own track.
 *
 * **Why it decides where his voice comes from.** On Android, and Quest Browser is an Android app,
 * Chromium uses one of two echo cancellers, and only one of them can keep a voice played through
 * Web Audio out of the microphone. When the device registers an acoustic echo canceller of its own
 * (`AcousticEchoCanceler.isAvailable()`), Chromium captures in the platform's voice-communication
 * mode and leaves cancellation to it, and the platform's reference is what the device plays —
 * Web Audio included. Otherwise it runs WebRTC's own canceller in the page, whose reference is only
 * what WebRTC itself plays, after the element's volume: a voice panned through Web Audio would not
 * be subtracted, and the SDK's element at volume 0 would hand it a reference of silence. So his
 * voice can only come from where he stands when the platform's canceller is there.
 *
 * **How it is read.** Since Chromium 141 a track's capabilities list the echo cancellation modes
 * it offers, and on Android `'all'` (cancel everything the device plays) is offered only when that
 * platform canceller exists. Quest Browser is well past 141, so a list without `'all'` is read as
 * the browser's canceller alone; a browser with no list at all says nothing either way. The
 * capabilities are the device's, not the track's current settings, so a wake stream opened without
 * processing (`?microphone=raw`) still says what the call's own capture, which asks for echo
 * cancellation, will get.
 */

/**
 * - `platform` — the device cancels echo itself, including whatever Web Audio plays.
 * - `browser` — only the browser's canceller, which hears only what WebRTC plays.
 * - `unknown` — the browser does not say.
 */
export type EchoCanceller = 'platform' | 'browser' | 'unknown';

/** As much of a `MediaStreamTrack` as the probe reads. */
export interface ProbedTrack {
  getCapabilities?(): unknown;
}

/** The echo canceller behind `track`, the wake word's microphone track. */
export function probeEchoCanceller(track: ProbedTrack | undefined): EchoCanceller {
  if (track === undefined || typeof track.getCapabilities !== 'function') return 'unknown';
  let capabilities: unknown;
  try {
    capabilities = track.getCapabilities();
  } catch {
    return 'unknown';
  }
  if (typeof capabilities !== 'object' || capabilities === null) return 'unknown';
  const modes: unknown = Reflect.get(capabilities, 'echoCancellation');
  if (!Array.isArray(modes)) return 'unknown';
  return modes.includes('all') ? 'platform' : 'browser';
}
