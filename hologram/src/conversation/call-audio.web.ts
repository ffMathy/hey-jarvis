/**
 * A browser has no call audio to switch into, and `@livekit/react-native` is not something it can
 * load: the greeting plays as it is. See `call-audio.ts`.
 */
export async function startCallAudio(): Promise<void> {}

export async function stopCallAudio(): Promise<void> {}
