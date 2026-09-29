/**
 * The clock the view runs Jarvis on: how often his voice is read, how quickly he falls into a
 * thought and leaves, the fastest he is ever redrawn, and the seed his shape is built from.
 *
 * In the main entry, and apart from the view that uses them, so that anything else drawing him —
 * the headset's frame loop, the preview and showcase scripts — steps him by the same numbers
 * rather than by copies of them. The view itself lives in `hologram/react`, which cannot be
 * imported without React Native, Reanimated and Skia; these are plain numbers and import nothing.
 */

/**
 * How long Jarvis takes to go.
 *
 * Shorter than he takes to arrive: leaving should not be a ceremony. Whoever sets a hologram's
 * `leaving` prop has to keep its screen alive for this long before closing anything, so the number
 * is shared rather than guessed at twice.
 *
 * `hologram/react/lifecycle` hands it on to the screens that wait for it (see
 * `react/leaving.ts`), since they need it before Skia is loadable.
 */
export const LEAVING_SECONDS = 0.45;

/** How long it takes to fall into a thought, and to come out of one. */
export const THOUGHT_FADE_SECONDS = 0.45;

/**
 * How often the voice is read. The SDK's native processors refresh every 40 ms,
 * so reading faster only re-reads the same value; the UI thread eases between
 * readings every frame, which is where the smoothness comes from.
 */
export const READ_INTERVAL_MS = 40;

/**
 * The shortest gap between two drawn frames: a hundred and twenty a second at most.
 *
 * **This is a safety rail, not the frame rate.** What Jarvis actually runs at is decided by
 * `density-control.ts`, which adds particles until building a picture takes `BUILD_BUDGET_MS`, and
 * never past a count at which the frame rate was seen falling below `TARGET_FRAMES_PER_SECOND`. This
 * only stops a very fast phone with very few particles from redrawing faster than any screen can
 * show.
 *
 * **It was a forty-eighth for an hour, and that was a real mistake**: capping at the rate the loop
 * was aiming for made the loop blind, because a measurement can never come back above its own cap,
 * so "exactly fast enough" and "could draw three times as much" read identically. On a 60 Hz screen
 * it was worse than blind. A gate can only produce the refresh divided by a whole number, so a
 * forty-eighth yields thirty there — and the loop, told to hold forty, read thirty as the phone
 * struggling and stripped the particles to the floor. Two hundred and fifty of the five thousand
 * there were then, at a rate the cap itself had imposed.
 *
 * A hundred-and-twenty-eighth rather than a hundred-and-twentieth so the arithmetic lands on the
 * right side of a real screen's timing: at 120 Hz frames arrive every 8.3 ms, which clears 7.8 and
 * draws every one.
 *
 * The clock is not tied to it either way. Time keeps adding up every frame the screen offers and
 * the whole of it is handed over when a picture is built, so this changes how often Jarvis is drawn
 * and never how fast he moves.
 */
export const MINIMUM_FRAME_SECONDS = 1 / 128;

/** Fixed, so the hologram has the same shape every time the app opens. */
export const SCENE_SEED = 1337;
