/**
 * Jarvis himself: the sphere, the ear that tells it when someone is talking, and what it takes to
 * reach the agent doing the talking.
 *
 * A package of its own rather than a folder in the phone app, because there are now two devices
 * that are Jarvis — the phone and the watch — and he should only ever be built once. Nothing in
 * this entry imports anything that is not a type, which is what makes that possible: the drawing
 * takes a Skia and a canvas as arguments (see `hologram-drawing.ts`), so it runs against native
 * Skia on a device, against CanvasKit in a browser, and against CanvasKit headless in the tests,
 * without knowing which it is doing. The two ElevenLabs files below keep the same rule — one
 * imports nothing at all, the other one type and the global `fetch` — so the whole of this entry
 * is still testable with no device, no SDK and no credential.
 *
 * What belongs here is anything with no platform in it. What does not is anything that touches a
 * microphone, a view tree, a clock or an SDK — those live in `./react`, in `./conversation`, or in
 * the app that has one.
 */
export * from './conversation-token';
export * from './density-control';
export * from './elevenlabs-settings';
export * from './hologram-drawing';
export * from './sample-mode';
export * from './simulated-voice';
export * from './voice-analysis';
export * from './voice-contract';
export * from './voice-levels';
