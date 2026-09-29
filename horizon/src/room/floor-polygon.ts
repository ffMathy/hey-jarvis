/**
 * Shapes on the floor: the room's outline seen from above, as x/z polygons.
 *
 * Nothing here assumes a rectangle. Quest's Space Setup draws floors as rectangles today, but a
 * room outline traced by hand is any polygon, and the other headsets' planes can be too.
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
    const a = polygon[index];
    const b = polygon[previous];
    if (a.z > point.z === b.z > point.z) continue;
    const crossingX = a.x + ((point.z - a.z) / (b.z - a.z)) * (b.x - a.x);
    if (point.x < crossingX) inside = !inside;
  }
  return inside;
}

/** The polygon's area, whatever its winding. */
export function areaOf(polygon: readonly FloorPoint[]): number {
  let twiceArea = 0;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[previous];
    const b = polygon[index];
    twiceArea += a.x * b.z - b.x * a.z;
  }
  return Math.abs(twiceArea) / 2;
}

/**
 * The smallest convex polygon around `points`, anticlockwise seen from above (Andrew's monotone
 * chain), or an empty list when they do not enclose any area.
 */
export function convexHull(points: readonly FloorPoint[]): FloorPoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  if (sorted.length < 3) return [];
  const turn = (o: FloorPoint, a: FloorPoint, b: FloorPoint) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const chain = (ordered: FloorPoint[]) => {
    const hull: FloorPoint[] = [];
    for (const point of ordered) {
      while (hull.length >= 2 && turn(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) hull.pop();
      hull.push(point);
    }
    hull.pop();
    return hull;
  };
  const hull = [...chain(sorted), ...chain(sorted.reverse())];
  return areaOf(hull) > 1e-6 ? hull : [];
}
