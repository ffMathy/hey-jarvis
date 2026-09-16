/**
 * Jarvis himself: the sphere, and the ear that tells it when someone is talking.
 *
 * A package of its own rather than a folder in the phone app, because there are now two things
 * that draw him — the phone and the watch — and he should only ever be designed once. Nothing in
 * here imports anything that is not a type, which is what makes that possible: the drawing takes
 * a Skia and a canvas as arguments (see `hologram-drawing.ts`), so it runs against native Skia on
 * a device, against CanvasKit in a browser, and against CanvasKit headless in the tests, without
 * knowing which it is doing.
 *
 * What belongs here is anything with no platform in it. What does not is anything that touches a
 * microphone, a view tree or a clock — those live in the app that has one.
 */
export * from './hologram-drawing';
export * from './voice-analysis';
export * from './voice-levels';
