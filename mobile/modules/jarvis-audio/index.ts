import { requireOptionalNativeModule } from 'expo';

/**
 * Raw audio from the microphone or from a remote WebRTC track, kept natively and
 * read on demand — see `JarvisAudioModule.kt`.
 */
export interface JarvisAudio {
  /** Starts WebRTC's recorder and keeps what it records. Needs the microphone permission already granted. */
  startMicrophone(): void;
  /** Stops it again. Synchronous, so an unmounting screen has let go before the next one starts. */
  stopMicrophone(): void;
  /** Keeps what plays on the remote audio track `trackId` of peer connection `peerConnectionId` instead. */
  listenToTrack(peerConnectionId: number, trackId: string): void;
  stopListeningToTrack(): void;
  /** The rate of the audio kept, or 0 before any has arrived. */
  sampleRate(): number;
  /** Up to `sampleCount` of the latest samples, oldest first, as 16-bit little-endian bytes. */
  readLatest(sampleCount: number): Uint8Array;
}

/**
 * Optional, like the assistant module: absent on web, under `bun test` and in any
 * build without the native side, where callers fall back to the ElevenLabs SDK's
 * readings or to silence.
 */
export const jarvisAudio = requireOptionalNativeModule<JarvisAudio>('JarvisAudio') ?? undefined;
