/**
 * Two handlers for the same event, called one after the other.
 *
 * `startSession` takes one handler per event, and more than one hook here wants some of them —
 * `onVadScore` feeds both the listening lattice and the hang-up, `onMessage` both a screen's written
 * reply and the hang-up. Spread side by side, the second would silently replace the first.
 */
export function inTurn<Event>(first: (event: Event) => void, second: (event: Event) => void): (event: Event) => void {
  return (event) => {
    first(event);
    second(event);
  };
}
