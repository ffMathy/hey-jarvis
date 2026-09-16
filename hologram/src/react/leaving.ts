/**
 * How long Jarvis takes to go.
 *
 * Shorter than he takes to arrive: leaving should not be a ceremony. Whoever sets a hologram's
 * `leaving` prop has to keep its screen alive for this long before closing anything, so the number
 * is shared rather than guessed at twice.
 *
 * In a file of its own, not beside the view that uses it, because the screens that wait for it need
 * it before Skia is loadable — see `lifecycle.ts`.
 */
export const LEAVING_SECONDS = 0.45;
