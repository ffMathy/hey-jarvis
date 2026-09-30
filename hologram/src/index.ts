/**
 * Jarvis himself: the sphere, the ear that tells it when someone is talking, and what it takes to
 * reach the agent doing the talking.
 *
 * A package of its own rather than a folder in the phone app, because there are three devices that
 * are Jarvis — the phone, the watch and the Quest headset — and he should only ever be built once.
 * Nothing in this entry imports a value from outside the package but Skia's enums, which are plain
 * numbers, and that is what makes it possible: the drawing takes a Skia and a canvas as arguments
 * (see `hologram-drawing.ts`), so it runs against native Skia on a device, against CanvasKit in a
 * browser, and against CanvasKit headless in the tests, without knowing which it is doing. The
 * ElevenLabs files and the conversation's framework-free parts keep the same rule — the token
 * request uses the global `fetch`, the SDK's events and LiveKit's room are named structurally, and
 * a timer or a room check is handed in rather than reached for — so the whole of this entry is
 * still testable with no device, no SDK and no credential.
 *
 * What belongs here is anything with no platform in it. What does not is anything that touches a
 * microphone, a view tree or an SDK, or keeps a clock of its own — those live in `./react`, in
 * `./conversation`, or in the app that has one.
 */
export * from './agent-audio-track';
export * from './conversation-life';
export * from './conversation-token';
export * from './density-control';
export * from './elevenlabs-settings';
export * from './frame-clock';
export * from './frame-timing';
export * from './greeting-handover';
export * from './greeting-voice';
export * from './hearing';
export * from './hologram-drawing';
export * from './played-voice';
export * from './queued-audio';
export * from './sample-mode';
export * from './simulated-voice';
export * from './tool-activity';
export * from './vad-score';
export * from './voice-analysis';
export * from './voice-contract';
export * from './voice-levels';
export * from './written-reply';
