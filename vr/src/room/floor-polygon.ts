/**
 * Shapes on the floor: the room's outline seen from above, as x/z polygons.
 *
 * Nothing here assumes a rectangle. Quest's Space Setup draws floors as rectangles today, but a
 * room outline traced by hand is any polygon, and the other headsets' planes can be too. A
 * plane's own polygon (x/z in its own space) is one of these as well.
 */

/** A point on the floor plan: x and z in the reference space. */
export interface FloorPoint {
  x: number;
  z: number;
}

/** Whether `point` is inside `polygon`, by the even-odd rule (either winding, no closing point needed). */
export function containsPoint(polygon: readonly FloorPoint[], point: FloorPoint): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const corner = polygon[index];
    const previousCorner = polygon[previous];
    if (corner.z > point.z === previousCorner.z > point.z) continue;
    const crossingX = corner.x + ((point.z - corner.z) / (previousCorner.z - corner.z)) * (previousCorner.x - corner.x);
    if (point.x < crossingX) inside = !inside;
  }
  return inside;
}

/** How far `point` is from the edge running from `start` to `end`. */
function distanceToEdge(point: FloorPoint, start: FloorPoint, end: FloorPoint): number {
  const edgeX = end.x - start.x;
  const edgeZ = end.z - start.z;
  const lengthSquared = edgeX * edgeX + edgeZ * edgeZ;
  const along =
    lengthSquared === 0
      ? 0
      : Math.min(Math.max(((point.x - start.x) * edgeX + (point.z - start.z) * edgeZ) / lengthSquared, 0), 1);
  return Math.hypot(point.x - (start.x + along * edgeX), point.z - (start.z + along * edgeZ));
}

/** Whether `point` is inside `polygon` or within `tolerance` of its outline. */
export function coversPoint(polygon: readonly FloorPoint[], point: FloorPoint, tolerance: number): boolean {
  if (containsPoint(polygon, point)) return true;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    if (distanceToEdge(point, polygon[previous], polygon[index]) <= tolerance) return true;
  }
  return false;
}

/** The polygon's area, whatever its winding. */
export function areaOf(polygon: readonly FloorPoint[]): number {
  let twiceArea = 0;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const previousCorner = polygon[previous];
    const corner = polygon[index];
    twiceArea += previousCorner.x * corner.z - corner.x * previousCorner.z;
  }
  return Math.abs(twiceArea) / 2;
}

/** Twice the signed area of the triangle `origin`, `first`, `second`: positive for one turning direction, negative for the other. */
function turn(origin: FloorPoint, first: FloorPoint, second: FloorPoint): number {
  return (first.x - origin.x) * (second.z - origin.z) - (first.z - origin.z) * (second.x - origin.x);
}

/** One side of a convex hull, over points sorted along x (Andrew's monotone chain). */
function hullChain(ordered: readonly FloorPoint[]): FloorPoint[] {
  const chain: FloorPoint[] = [];
  for (const point of ordered) {
    while (chain.length >= 2 && turn(chain[chain.length - 2], chain[chain.length - 1], point) <= 0) chain.pop();
    chain.push(point);
  }
  // The last point starts the other side.
  chain.pop();
  return chain;
}

/** The smallest convex polygon around `points`, or an empty list when they do not enclose any area. */
export function convexHull(points: readonly FloorPoint[]): FloorPoint[] {
  const sorted = [...points].sort((first, second) => first.x - second.x || first.z - second.z);
  if (sorted.length < 3) return [];
  const hull = [...hullChain(sorted), ...hullChain([...sorted].reverse())];
  return areaOf(hull) > 1e-6 ? hull : [];
}
