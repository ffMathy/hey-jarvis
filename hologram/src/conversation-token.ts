/**
 * What each device calls itself in the ElevenLabs conversation history.
 *
 * Every name lives here rather than in the app that uses it, because the point of them is to be
 * told apart: a conversation held on the wrist should be distinguishable in the history from one
 * held on the phone, from one held in a headset, from one held through the house speakers, and from
 * one held over the phone line. Apps each naming themselves would drift into two names for the same
 * thing. The paired server asks ElevenLabs under the name it is sent.
 */
export const PHONE_PARTICIPANT_NAME = 'jarvis-android';
export const WATCH_PARTICIPANT_NAME = 'jarvis-wear';
/** The Quest headset's, where he stands in the room with you (`vr/`). */
export const HEADSET_PARTICIPANT_NAME = 'jarvis-vr';

/**
 * Where one conversation's credential comes from: a WebRTC token for a spoken conversation, a
 * signed WebSocket URL for a typed one.
 *
 * WebRTC for every spoken conversation, because it is the only transport `@elevenlabs/react-native`
 * supports on a device and the only one that carries audio. A signed URL only for a browser with no
 * microphone: a text-only conversation publishes no audio, and ElevenLabs' WebRTC room waits for
 * some before it finishes coming up, so a typed conversation dialled over WebRTC would sit in
 * `connecting` for ever.
 *
 * No device holds an ElevenLabs key. Every one is paired with sir's Jarvis server, which holds the
 * key and asks ElevenLabs on the device's behalf (`pairedCredentials` in `paired-device.ts`).
 */
export interface ConversationCredentials {
  /** A token for one spoken conversation, under the name this device goes by in the history. */
  token(participantName: string, fetchImplementation?: typeof fetch): Promise<string>;
  /** A signed `wss://` URL for one typed conversation. */
  signedUrl(fetchImplementation?: typeof fetch): Promise<string>;
}
