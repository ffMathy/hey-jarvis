/**
 * How big Jarvis is in the room, and how far away.
 *
 * The phone's drawing is sized from one number, the sphere's radius R, and so is he here: every
 * length the room uses is a multiple of it, in metres of the user's own room.
 *
 * This file imports nothing, on purpose: the browser tests read it to check where he was put,
 * and Playwright's loader cannot follow an import into the `hologram` package's TypeScript.
 */

/**
 * The sphere's radius at rest.
 *
 * About the size of a head, so he reads as someone rather than as a planet or a bead. What
 * leaves him — chips on a syllable, the swell while he talks — reaches about 1.9R, so he takes
 * up a bit under a metre of air.
 */
export const HOLOGRAM_RADIUS_METRES = 0.22;

/**
 * How far ahead of the head he appears.
 *
 * Conversational distance: near enough that he fills the view the way the phone's sphere fills
 * its screen, far enough that he is not in anyone's face.
 */
export const DISTANCE_AHEAD_METRES = 1.6;
