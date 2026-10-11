import { requireOptionalNativeModule } from 'expo';
import type { HeldVoice } from '../session-contract';

/** The half of `hologram/android`'s `JarvisGreetingModule` that keeps what is said while he connects. */
interface HeldVoiceModule {
  holdVoice(): void;
  releaseVoice(): void;
  dropVoice(): void;
}

/** Absent in a build without the native side, where what is said while he connects is lost, as it always was. */
const heldVoiceModule = requireOptionalNativeModule<HeldVoiceModule>('JarvisGreeting') ?? undefined;

/**
 * What sir says while a phone or a watch connects, kept natively and played into the conversation's
 * own microphone track once the agent is listening — see `HeldVoice.kt`.
 *
 * A device dials only once the greeting is over (`waitsForGreetingBeforeDialling`), so between his
 * last word and the agent hearing anything there is a token, a room and a handshake — a second or
 * more in which whatever sir started saying used to go nowhere. The microphone is kept from the
 * greeting's end, and once the agent listens what was kept goes first and the live microphone queues
 * behind it, so the agent hears everything, in order, and simply a little late; the lateness is
 * then worked off in sir's pauses.
 *
 * The agent hears it over WebRTC, the only transport the SDK has on a device, and WebRTC sends only
 * what passes through the microphone track — the SDK drops any `user_audio_chunk` it is handed over
 * a room. So it goes through the track, as LiveKit's capture post-processor, rather than beside it.
 */
export const heldVoice: HeldVoice | undefined = heldVoiceModule && {
  hold: () => heldVoiceModule.holdVoice(),
  release: () => heldVoiceModule.releaseVoice(),
  drop: () => heldVoiceModule.dropVoice(),
};
