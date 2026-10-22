/**
 * How near the head may come to him.
 *
 * Headset-only, so it is here rather than with the view-basis maths in `hologram/gpu`.
 */

/**
 * How much of him to show when the head is `distance` metres from his centre and he is `radius`
 * across at rest: all of him from 2.5 radii out, nothing inside 1.5.
 *
 * Someone who walks into him should not find their view filled with his inside: it is where the
 * GPU's cost goes up with the square of how close they are, where the near plane starts cutting
 * strokes in half, and where chips thrown at 1.6–1.9R would fly through their face. So he fades
 * out as they come within reach and back as they step away.
 */
export function closeRangeFade(distance: number, radius: number): number {
  const share = distance / radius - 1.5;
  const clamped = share < 0 ? 0 : share > 1 ? 1 : share;
  return clamped * clamped * (3 - 2 * clamped);
}
