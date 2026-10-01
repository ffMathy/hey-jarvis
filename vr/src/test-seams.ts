/**
 * The seams the browser tests hold the room's clocks with, read once from the page's URL.
 *
 * Two budgets in the app are counted on the wall clock: the twenty seconds a summoning waits for
 * its conversation to open (`GIVE_UP_CONNECTING_AFTER_MS` in `hologram`), and the six seconds at
 * least that an error panel stays up (`SHORTEST_ERROR_MS` in `app/app-state.ts`). On a headset
 * both are far longer than anything they wait for. In the emulator the room is drawn by
 * SwiftShader on a CPU, a frame a second while he is there and slower on a loaded machine, so the
 * specs that keep him greeting on a token that never comes, and the ones that photograph a panel
 * (a picture takes the emulator seconds), were racing them — and losing whenever the machine was
 * busy. No fixed wait is long enough on every machine the specs run on, so a spec that depends on
 * one of them opens the page saying so instead:
 *
 * - `?deadline=never`: the session never gives up on a conversation that has not opened, so he
 *   stays greeting, and then connecting, for as long as the spec needs him to.
 * - `?errors=held`: an error panel stays up until a select or B dismisses it, which on a headset
 *   can end it at any moment too, so a picture of it is always a picture of the panel.
 *
 * Nothing else changes, and without them the page is exactly what a headset runs. The budgets
 * themselves are pinned by the unit tests: `jarvis-session.spec.ts` in `hologram` and
 * `app/app-state.spec.ts`. `?origin` is the third seam; it has a module of its own
 * (`xr/origin-offset.ts`), since what it asks for is a place rather than a yes.
 */
export interface TestSeams {
  /** How long the session waits for a conversation to open: for ever, or its own deadline when undefined. */
  giveUpConnectingAfterMs: number | undefined;
  /** Whether an error panel stays up until it is dismissed, rather than for as long as it takes to read. */
  holdErrors: boolean;
}

/**
 * The seams `flags` (the page's URL parameters) ask for. Only the exact spellings above count:
 * anything else leaves the page as a headset has it, which is the safe way for a typo to fail.
 */
export function readTestSeams(flags: URLSearchParams): TestSeams {
  return {
    giveUpConnectingAfterMs: flags.get('deadline') === 'never' ? Number.POSITIVE_INFINITY : undefined,
    holdErrors: flags.get('errors') === 'held',
  };
}
