/**
 * A satellite's glyph, an SVG path in glyph radii, flattened into the straight runs the picture
 * draws its strokes from — round-capped and round-joined, as the glyph's paint is, so every run
 * starts and ends round and the path's own ends need nothing more.
 *
 * The glyphs come from the server, a few hundred characters of only the commands a glyph is made of
 * (`DRAWABLE_GLYPH`: M, L, H, V, A, C, Q, Z, either case), and are flattened on the thread that draws
 * them, once for each glyph a satellite shows, so this is a worklet and keeps to what a worklet may
 * do: no regular expressions, no closures, nothing allocated but its result.
 */

/** How many numbers each of a glyph's runs is: from x, y, to x, y, and which of its ends are joins. */
export const GLYPH_RUN_NUMBERS = 5;

/** How many runs a curve is flattened into, and how much of a turn an elliptical arc's run spans at most. */
const CURVE_RUNS = 12;
const ARC_RUN_RADIANS = 0.2;

function isCommand(code: number): boolean {
  'worklet';
  // M m L l H h V v A a C c Q q Z z
  return (
    code === 77 ||
    code === 109 ||
    code === 76 ||
    code === 108 ||
    code === 72 ||
    code === 104 ||
    code === 86 ||
    code === 118 ||
    code === 65 ||
    code === 97 ||
    code === 67 ||
    code === 99 ||
    code === 81 ||
    code === 113 ||
    code === 90 ||
    code === 122
  );
}

function isNumberStart(code: number): boolean {
  'worklet';
  return (code >= 48 && code <= 57) || code === 45 || code === 46 || code === 43;
}

/**
 * The path's commands and numbers, in order: each command as its letter, each number as a number.
 * An arc's two flags may be written run together ("a1 1 0 01 2 2"), so they are read as single
 * digits where an arc's arguments put them.
 */
function tokens(path: string): (string | number)[] {
  'worklet';
  const read: (string | number)[] = [];
  let at = 0;
  let argument = 0;
  let command = '';
  while (at < path.length) {
    const code = path.charCodeAt(at);
    if (isCommand(code)) {
      command = path[at];
      read.push(command);
      argument = 0;
      at++;
      continue;
    }
    if (!isNumberStart(code)) {
      at++;
      continue;
    }
    const lower = command.toLowerCase();
    if (lower === 'a' && (argument % 7 === 3 || argument % 7 === 4) && (code === 48 || code === 49)) {
      read.push(code - 48);
      argument++;
      at++;
      continue;
    }
    let end = at + 1;
    let seenPoint = path[at] === '.';
    let seenExponent = false;
    while (end < path.length) {
      const next = path.charCodeAt(end);
      if (next >= 48 && next <= 57) {
        end++;
      } else if (next === 46 && !seenPoint && !seenExponent) {
        seenPoint = true;
        end++;
      } else if ((next === 101 || next === 69) && !seenExponent) {
        seenExponent = true;
        end++;
        if (path[end] === '-' || path[end] === '+') end++;
      } else {
        break;
      }
    }
    read.push(Number(path.slice(at, end)));
    argument++;
    at = end;
  }
  return read;
}

/** The next point of the subpath being drawn, as x and y in turn. */
function pushPoint(points: number[], x: number, y: number) {
  'worklet';
  points.push(x, y);
}

/**
 * A subpath's points as runs, GLYPH_RUN_NUMBERS each: from x, y, to x, y, and which of its ends it
 * shares with the run before or after it (1 the start, 2 the end, 3 both). A closed subpath's last
 * run joins its first.
 */
function pushSubpath(runs: number[], points: number[], closed: boolean) {
  'worklet';
  const count = points.length / 2;
  if (count < 2) return;
  const last = count - 1;
  for (let point = 1; point < count; point++) {
    const hasBefore = point > 1 || closed;
    const hasAfter = point < last || closed;
    runs.push(
      points[(point - 1) * 2],
      points[(point - 1) * 2 + 1],
      points[point * 2],
      points[point * 2 + 1],
      (hasBefore ? 1 : 0) + (hasAfter ? 2 : 0),
    );
  }
}

/** An SVG elliptical arc from one point to another, as runs (the specification's F.6.5 conversion). */
function pushArc(
  points: number[],
  fromX: number,
  fromY: number,
  radiusXGiven: number,
  radiusYGiven: number,
  rotationDegrees: number,
  large: number,
  sweepFlag: number,
  toX: number,
  toY: number,
) {
  'worklet';
  let radiusX = Math.abs(radiusXGiven);
  let radiusY = Math.abs(radiusYGiven);
  if (radiusX === 0 || radiusY === 0 || (fromX === toX && fromY === toY)) {
    pushPoint(points, toX, toY);
    return;
  }
  const rotation = (rotationDegrees * Math.PI) / 180;
  const cosRotation = Math.cos(rotation);
  const sinRotation = Math.sin(rotation);
  const halfX = (fromX - toX) / 2;
  const halfY = (fromY - toY) / 2;
  const primeX = cosRotation * halfX + sinRotation * halfY;
  const primeY = -sinRotation * halfX + cosRotation * halfY;
  const scale = (primeX * primeX) / (radiusX * radiusX) + (primeY * primeY) / (radiusY * radiusY);
  if (scale > 1) {
    radiusX *= Math.sqrt(scale);
    radiusY *= Math.sqrt(scale);
  }
  const numerator =
    radiusX * radiusX * radiusY * radiusY - radiusX * radiusX * primeY * primeY - radiusY * radiusY * primeX * primeX;
  const denominator = radiusX * radiusX * primeY * primeY + radiusY * radiusY * primeX * primeX;
  const root = Math.sqrt(Math.max(0, numerator / denominator)) * (large === sweepFlag ? -1 : 1);
  const centrePrimeX = (root * radiusX * primeY) / radiusY;
  const centrePrimeY = (-root * radiusY * primeX) / radiusX;
  const centreX = cosRotation * centrePrimeX - sinRotation * centrePrimeY + (fromX + toX) / 2;
  const centreY = sinRotation * centrePrimeX + cosRotation * centrePrimeY + (fromY + toY) / 2;
  const startAngle = Math.atan2((primeY - centrePrimeY) / radiusY, (primeX - centrePrimeX) / radiusX);
  let sweep = Math.atan2((-primeY - centrePrimeY) / radiusY, (-primeX - centrePrimeX) / radiusX) - startAngle;
  if (sweepFlag === 0 && sweep > 0) sweep -= Math.PI * 2;
  if (sweepFlag === 1 && sweep < 0) sweep += Math.PI * 2;
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / ARC_RUN_RADIANS));
  for (let step = 1; step <= steps; step++) {
    const angle = startAngle + (sweep * step) / steps;
    const ellipseX = Math.cos(angle) * radiusX;
    const ellipseY = Math.sin(angle) * radiusY;
    pushPoint(
      points,
      step === steps ? toX : centreX + cosRotation * ellipseX - sinRotation * ellipseY,
      step === steps ? toY : centreY + sinRotation * ellipseX + cosRotation * ellipseY,
    );
  }
}

/** A quadratic (control twice) or cubic Bézier curve as runs. */
function pushCurve(
  points: number[],
  fromX: number,
  fromY: number,
  firstX: number,
  firstY: number,
  secondX: number,
  secondY: number,
  toX: number,
  toY: number,
) {
  'worklet';
  for (let step = 1; step <= CURVE_RUNS; step++) {
    const share = step / CURVE_RUNS;
    const left = 1 - share;
    const pointX =
      left * left * left * fromX +
      3 * left * left * share * firstX +
      3 * left * share * share * secondX +
      share * share * share * toX;
    const pointY =
      left * left * left * fromY +
      3 * left * left * share * firstY +
      3 * left * share * share * secondY +
      share * share * share * toY;
    pushPoint(points, pointX, pointY);
  }
}

function numberAt(read: (string | number)[], at: number): number {
  'worklet';
  const value = read[at];
  return typeof value === 'number' ? value : Number.NaN;
}

/**
 * A glyph's runs, GLYPH_RUN_NUMBERS each (see `pushSubpath`), in glyph radii; an empty list for a path
 * that cannot be read, which the caller draws as the plain ring instead, as a glyph Skia could not
 * read was.
 */
export function flattenGlyph(path: string): number[] {
  'worklet';
  const read = tokens(path);
  const runs: number[] = [];
  let points: number[] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let command = '';
  let at = 0;
  while (at < read.length) {
    const token = read[at];
    if (typeof token === 'string') {
      command = token;
      at++;
      if (command === 'Z' || command === 'z') {
        if (x !== startX || y !== startY) pushPoint(points, startX, startY);
        pushSubpath(runs, points, points.length > 4);
        x = startX;
        y = startY;
        points = [x, y];
      }
      continue;
    }
    const relative = command === command.toLowerCase();
    const originX = relative ? x : 0;
    const originY = relative ? y : 0;
    const lower = command.toLowerCase();
    if (lower === 'm' || lower === 'l') {
      const toX = originX + numberAt(read, at);
      const toY = originY + numberAt(read, at + 1);
      if (lower === 'l') {
        pushPoint(points, toX, toY);
      } else {
        pushSubpath(runs, points, false);
        points = [toX, toY];
        startX = toX;
        startY = toY;
        // further pairs after a move are lines
        command = relative ? 'l' : 'L';
      }
      x = toX;
      y = toY;
      at += 2;
    } else if (lower === 'h') {
      x = originX + numberAt(read, at);
      pushPoint(points, x, y);
      at += 1;
    } else if (lower === 'v') {
      y = originY + numberAt(read, at);
      pushPoint(points, x, y);
      at += 1;
    } else if (lower === 'q') {
      const controlX = originX + numberAt(read, at);
      const controlY = originY + numberAt(read, at + 1);
      const toX = originX + numberAt(read, at + 2);
      const toY = originY + numberAt(read, at + 3);
      pushCurve(
        points,
        x,
        y,
        x + ((controlX - x) * 2) / 3,
        y + ((controlY - y) * 2) / 3,
        toX + ((controlX - toX) * 2) / 3,
        toY + ((controlY - toY) * 2) / 3,
        toX,
        toY,
      );
      x = toX;
      y = toY;
      at += 4;
    } else if (lower === 'c') {
      const toX = originX + numberAt(read, at + 4);
      const toY = originY + numberAt(read, at + 5);
      pushCurve(
        points,
        x,
        y,
        originX + numberAt(read, at),
        originY + numberAt(read, at + 1),
        originX + numberAt(read, at + 2),
        originY + numberAt(read, at + 3),
        toX,
        toY,
      );
      x = toX;
      y = toY;
      at += 6;
    } else if (lower === 'a') {
      const toX = originX + numberAt(read, at + 5);
      const toY = originY + numberAt(read, at + 6);
      pushArc(
        points,
        x,
        y,
        numberAt(read, at),
        numberAt(read, at + 1),
        numberAt(read, at + 2),
        numberAt(read, at + 3),
        numberAt(read, at + 4),
        toX,
        toY,
      );
      x = toX;
      y = toY;
      at += 7;
    } else {
      // a number with no command before it: not a path
      return [];
    }
  }
  pushSubpath(runs, points, false);
  for (let index = 0; index < runs.length; index++) {
    if (!Number.isFinite(runs[index])) return [];
  }
  return runs;
}
