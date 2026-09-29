/**
 * How long Jarvis takes to go, for the screens that wait for him.
 *
 * The number itself is in the main entry's `frame-timing.ts`, beside the rest of the clock the view
 * runs him on, so that a renderer with no React in it can reach it too. It is handed on from here,
 * in a file of its own rather than beside the view that uses it, because the screens that wait for
 * it need it before Skia is loadable — see `lifecycle.ts`.
 */
export { LEAVING_SECONDS } from '../frame-timing';
