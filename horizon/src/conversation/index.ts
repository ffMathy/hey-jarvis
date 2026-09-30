/**
 * Jarvis's conversation on the headset: `hologram`'s session, with what a page in Quest Browser
 * needs around it — the recorded greeting played through an `<audio>` element, his track listened
 * to on the app's `AudioContext`, his voice from where he stands when the headset can take it
 * (`spatial-voice.ts`), and the audio a dropped call leaves on the page cleared away.
 *
 * The session itself — the greeting and the token at once, the deadline, the failures in words,
 * the microphone rules, the captions, the half-duplex fallback — is `createJarvisSession` in
 * `hologram`'s main entry, which the phone and the watch run too. See `headset-session.ts` for what
 * the headset hands it.
 */

export { type EchoCanceller, probeEchoCanceller } from './echo-canceller';
export { createGreetingPlayer, type GreetingElement, type PrimableGreetingPlayer } from './greeting-player';
export { greetingRecordingUrl } from './greeting-recording';
export {
  createHeadsetSession,
  HEADSET_OFFLINE_PROBLEM,
  type HeadsetSessionOptions,
  headsetSessionDependencies,
  NO_CONNECTION_DELAY,
} from './headset-session';
export { createPageSpatialVoice, hasSpatialAudio } from './spatial-voice';
