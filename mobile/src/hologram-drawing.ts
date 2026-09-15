// The J.A.R.V.I.S. hologram: the golden, audio-reactive globe that stands in for
// Tony Stark's AI assistant in the Iron Man films, drawn every frame with React
// Native Skia's imperative canvas API from a Reanimated worklet.
//
// WHAT IT DEPICTS
// A tilted, slowly spinning sphere made of broken amber (#f0a040) line fragments
// with pale-gold (#ffe6b0) highlights instead of a solid surface. There is no haze
// at the limb: the silhouette comes from ragged fragments, protruding struts and a
// crown of spikes. A big soft tapered "C" ribbon, open on the right, curls into a
// knotted gold core; horizontal data streaks fade out of the core; translucent
// cool blue glass panels float mostly behind the gold. Depth: the back hemisphere
// is finer (1 px), dimmer and has no glow pass.
//
// LAYERS, drawn back to front
//   drawInteriorWarmth  faint warm fill inside the sphere (no limb halo)
//   drawRimWave         a brightness wave travelling around the rim, alive even when silent
//   drawGlassPanels     blue glass panels with data lines, and a few long grid lines
//   drawSphereShells    nested shells of broken latitude/longitude arcs, dashes and radial
//                       ticks: the outer frame in two rim groups (back hemisphere, then
//                       front), then the inner counter-rotating frame
//   drawRimRings        prebuilt dashed rings hugging the limb
//   drawSpecks          a volumetric field of specks, some twinkling into sparks
//   drawOrbitalRings    tilted dashed rings on the sphere
//   drawSpectrum        crown spikes, rim combs and protruding struts
//   drawCrescent        the "C" ribbon in three width tiers, and an arc hugging the core
//   drawCoreBloom       the warm core bloom and its comet tail
//   drawDataStreaks     horizontal streaks from the core, fading out in three tiers
//   drawKnot            small tilted loops forming the knotted core gyroscope
//
// HOW THE VOICE DRIVES IT (see analyseFrame)
// Voice only ever adds bounded offsets, never level × time, so motion cannot jump.
// `speaking` scales every audio value by 1 while speaking and by 0.8 while listening
// with a residual level (no step at level 0).
//
//   level  Clamped to 0..1 and scaled as above, then energy = level^0.8 (perceptual:
//          keeps loud troughs clearly above soft). Energy only adds a small swell: the
//          sphere radius grows by up to 2.5% (bass adds up to 1.2% more), glow passes
//          get up to 25% brighter, and it gives small nudges to arc growth, fragment
//          reveal, the C ribbon, the core and the knot. While listening, the level also
//          makes the glass panels up to 60% more present.
//   bands  24 magnitudes, low frequency first. Band averages get more gain the higher
//          they are, because speech is low-heavy:
//            0-4    ×1.1  bass: zone 0 (shells below 0.66), the inner frame, the C ribbon
//                         (sweep, radius, width, brightness), the core bloom, the knot and
//                         the sphere radius
//            5-8    ×1.3  zone 1: shells 0.66-0.83, rim ring 0.8, orbital ring 0.9
//            9-12   ×1.8  zone 2: shells 0.83-0.9, rim rings 0.855 and 0.9, orbital ring 0.97
//            13-17  ×2.6  zone 3: shells 0.9-0.96, rim ring 0.94, orbital ring 1.0
//            18-23  ×3.5  zone 4: shells from 0.96, rim rings 0.975 and 1.01
//            5-13   ×1.6  mids: interior warmth, glass panels, the C's curl, the comet
//                         tail and the data streaks
//            14-23  ×3    highs: size and brightness of the twinkling sparks
//          Frequency zones follow shell radius: lows inside, highs on the outer rim. A
//          zone's energy swells its shells, lengthens its unsplit arcs at both ends, and
//          reveals its short dashes and ticks through a smooth threshold on per-element
//          random ids (dashes grow, so nothing pops). The outer frame's line widths,
//          glow and highlights follow the average of zones 1-2 for fragments below shell
//          0.9 and of zones 3-4 above it; zones 3-4 also drive the rim wave and specks.
//          Crown spikes, rim combs and struts form a readable spectrum by screen angle:
//          each follows the (interpolated) band under it, lows at the top and highs at
//          the bottom, mirrored left and right, and its tip grows with band^1.5 in a
//          bright pale-gold path.
//
// PERFORMANCE AND WORKLET RULES
// - drawHologram and every helper it calls are worklets ('worklet' directive) that use
//   only their arguments: no module-level mutable state, no closures over outer values.
// - Build the scene and the resources ONCE per mounted canvas (a stable useMemo with no
//   changing dependencies). The resources hold mutable PathBuilders, so two mounted
//   canvases must never share one resources object.
// - Every PathBuilder is made once in createHologramResources, reset at the start of each
//   frame (so an exception mid-frame cannot leak contours into the next one) and reused:
//   detach() hands out the path and resets the builder.
// - Every paint uses Screen blending, so faint overlapping strokes add up like light: the
//   glow comes from wide faint strokes, with no blur filters. It is drawn over black.
// - Sphere geometry lives in unit space (sphere radius 1) and is drawn under
//   canvas.translate(centre)·scale(radius), so gradient shaders are built once. Fragment
//   endpoints are precomputed, so the frame loop does no trigonometry per fragment, and
//   each arc fragment is one exact conic.
import type { SkCanvas, Skia } from '@shopify/react-native-skia';
// The enums come from the package's type module rather than from its root, which
// imports react-native and so cannot load under `bun test` — where this file is
// drawn for real, headlessly, in hologram-drawing.spec.ts. They are the same values.
import { BlendMode, PaintStyle, StrokeCap, TileMode } from '@shopify/react-native-skia/lib/module/skia/types';

/** What one frame of the hologram is drawn from. */
export interface HologramFrame {
  /** Seconds since the hologram started. All motion derives from this. */
  time: number;
  /** Jarvis's voice level, eased, 0–1. */
  level: number;
  /** Frequency bands of his voice, eased, 0–1 each, lowest first (see voice-levels.ts). */
  bands: number[];
  /** Whether he is speaking, as opposed to the conversation merely being open. */
  speaking: boolean;
}

/**
 * The part of Skia the hologram draws with, and no more.
 *
 * Narrow on purpose. The app passes Skia from the package root; the headless test
 * passes the same API built over CanvasKit from the package's `lib/module` build,
 * whose declarations TypeScript treats as a separate copy. The members used here
 * are identical in both, so asking only for those lets both pass without a cast.
 */
export type HologramSkia = Pick<typeof Skia, 'Color' | 'Paint' | 'PathBuilder' | 'Shader'>;

/** The canvas calls the hologram makes, for the same reason. */
export type HologramCanvas = Pick<
  SkCanvas,
  'drawCircle' | 'drawPath' | 'restore' | 'rotate' | 'save' | 'scale' | 'translate'
>;

type SkiaApiType = HologramSkia;

// ---- scene: random geometry, built once on the JS thread ---------------------------------

type Random = () => number;

/** A Mulberry32-style seeded generator: the same seed always builds the same hologram. */
function createRandom(seed: number): Random {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Frequency zone of a shell radius: 0 = lows (inner shell, core) up to 4 = highs (outer rim). */
function zoneOfShell(shell: number) {
  if (shell < 0.66) return 0;
  if (shell < 0.83) return 1;
  if (shell < 0.9) return 2;
  if (shell < 0.96) return 3;
  return 4;
}

/** A random [shell radius, layer]; layer 0 = outer frame, 1 = inner counter-rotating frame. */
function pickShell(random: Random): [number, number] {
  const roll = random();
  if (roll < 0.58) return [0.74 + random() * 0.26, 0];
  if (roll < 0.84) return [0.62 + random() * 0.24, 0];
  return [0.3 + random() * 0.3, 1];
}

// Fragment specs, stride 9: kind (0 latitude arc, 1 longitude arc, 2 radial tick), shell,
// fixed angle, start angle, sweep (tick: length), zone, layer, chunky (1 = short dash),
// reveal id (a random 0..1 threshold; negative marks an arc split into pieces).

/** Appends an arc, split into pieces of at most 0.9 rad. */
function pushArcFragment(
  specs: number[],
  random: Random,
  kind: number,
  shell: number,
  fixedAngle: number,
  startAngle: number,
  sweep: number,
  layer: number,
  chunky: number,
) {
  const pieces = Math.max(1, Math.ceil(sweep / 0.9));
  const revealId = random();
  // single-piece arcs may grow their sweep with the voice; split arcs are marked negative (fixed)
  for (let piece = 0; piece < pieces; piece++) {
    specs.push(
      kind,
      shell,
      fixedAngle,
      startAngle + (sweep * piece) / pieces,
      sweep / pieces,
      zoneOfShell(shell),
      layer,
      chunky,
      pieces > 1 ? -revealId - 0.001 : revealId,
    );
  }
}

/** Long broken latitude and longitude arcs, and a few radial ticks. */
function pushBrokenArcs(specs: number[], random: Random) {
  const TAU = Math.PI * 2;
  for (let i = 0; i < 230; i++) {
    const [shell, layer] = pickShell(random);
    const latitude = Math.asin(random() * 2 - 1) * 0.97;
    const longitude = random() * TAU;
    const kindRoll = random();
    if (kindRoll < 0.66) {
      const length = 0.06 + random() ** 2 * 0.5;
      pushArcFragment(
        specs,
        random,
        0,
        shell,
        latitude,
        longitude,
        length / Math.max(0.3, Math.cos(latitude)),
        layer,
        0,
      );
    } else if (kindRoll < 0.9) {
      const length = 0.06 + random() ** 2 * 0.4;
      pushArcFragment(specs, random, 1, shell, longitude, latitude - length / 2, length, layer, 0);
    } else {
      specs.push(2, shell, latitude, longitude, 0.02 + random() * 0.06, zoneOfShell(shell), layer, 0, random());
    }
  }
}

/** Longitude ribs in the rim band: broken meridians that sell the globe. */
function pushRimRibs(specs: number[], random: Random) {
  for (let i = 0; i < 7; i++) {
    const longitude = (i / 7) * Math.PI + (random() - 0.5) * 0.3;
    const shell = 0.93 + random() * 0.05;
    let latitude = -1.25 + random() * 0.3;
    while (latitude < 1.15) {
      const length = 0.25 + random() * 0.55;
      pushArcFragment(specs, random, 1, shell, longitude, latitude, Math.min(length, 1.3 - latitude), 0, 0);
      latitude += length + 0.08 + random() * 0.3;
    }
  }
}

/** Short chunky data dashes (latitude) and ticks, revealed by the voice. */
function pushDataDashes(specs: number[], random: Random) {
  const TAU = Math.PI * 2;
  for (let i = 0; i < 470; i++) {
    const [shell, layer] = pickShell(random);
    const latitude = Math.asin(random() * 2 - 1) * 0.97;
    const longitude = random() * TAU;
    const length = 0.014 + random() ** 2 * 0.07;
    if (random() < 0.78) {
      const sweep = length / Math.max(0.3, Math.cos(latitude));
      specs.push(0, shell, latitude, longitude, sweep, zoneOfShell(shell), layer, 1, random());
    } else {
      specs.push(2, shell, latitude, longitude, length * 0.7, zoneOfShell(shell), layer, 1, random());
    }
  }
}

/** Unit-sphere point on a latitude circle (kind 0) or a longitude circle (kind 1). */
function pointOnSphere(kind: number, fixedAngle: number, angle: number): [number, number, number] {
  if (kind === 0) {
    return [Math.cos(fixedAngle) * Math.cos(angle), Math.sin(fixedAngle), Math.cos(fixedAngle) * Math.sin(angle)];
  }
  return [Math.cos(angle) * Math.cos(fixedAngle), Math.sin(angle), Math.cos(angle) * Math.sin(fixedAngle)];
}

/**
 * Precomputes unit-sphere geometry so the frame loop does no trigonometry.
 * Stride 18: type (0 conic arc, 1 short dash as a chord, 2 radial tick), shell, zone, layer,
 * chunky, reveal id, a (x, y, z), b (x, y, z), c (x, y, z), weight, sinHalfSweep, centreY.
 *   type 0: a = start, b = conic control (already divided by the weight), c = end,
 *           weight = cos(half sweep), sinHalfSweep = sin(half sweep) or 0 when the arc must
 *           not grow, centreY = height of the circle's centre
 *   type 1: a = chord midpoint, b = half chord vector
 *   type 2: a = unit direction, b.x = base length
 */
function buildFragmentGeometry(specs: number[]) {
  const geometry: number[] = [];
  for (let offset = 0; offset < specs.length; offset += 9) {
    const [kind, shell, fixedAngle, startAngle, sweep, zone, layer, chunky, signedRevealId] = specs.slice(
      offset,
      offset + 9,
    );
    const revealId = Math.abs(signedRevealId);
    if (kind === 2) {
      const direction = pointOnSphere(0, fixedAngle, startAngle);
      geometry.push(2, shell, zone, layer, chunky, revealId, direction[0], direction[1], direction[2], sweep);
      geometry.push(0, 0, 0, 0, 0, 1, 0, 0);
    } else if (chunky > 0.5) {
      const start = pointOnSphere(kind, fixedAngle, startAngle);
      const end = pointOnSphere(kind, fixedAngle, startAngle + sweep);
      geometry.push(1, shell, zone, layer, chunky, revealId);
      geometry.push((start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2);
      geometry.push((end[0] - start[0]) / 2, (end[1] - start[1]) / 2, (end[2] - start[2]) / 2);
      geometry.push(0, 0, 0, 1, 0, 0);
    } else {
      const weight = Math.cos(sweep / 2);
      const start = pointOnSphere(kind, fixedAngle, startAngle);
      const middle = pointOnSphere(kind, fixedAngle, startAngle + sweep / 2);
      const end = pointOnSphere(kind, fixedAngle, startAngle + sweep);
      const centreY = kind === 0 ? Math.sin(fixedAngle) : 0;
      geometry.push(0, shell, zone, layer, chunky, revealId, start[0], start[1], start[2]);
      // latitude circles are centred on the axis at height y, so only x/z scale by 1/weight
      geometry.push(middle[0] / weight, kind === 0 ? middle[1] : middle[1] / weight, middle[2] / weight);
      geometry.push(end[0], end[1], end[2], weight, signedRevealId < 0 ? 0 : Math.sin(sweep / 2), centreY);
    }
  }
  return geometry;
}

function pickSpeckShell(random: Random) {
  const roll = random();
  if (roll < 0.35) return 0.8 + random() * 0.19;
  if (roll < 0.75) return 0.5 + random() * 0.3;
  return 0.2 + random() * 0.3;
}

/**
 * Specks: mostly inside the sphere (a volumetric field), few at the rim, none outside.
 * Stride 10: shell, zone, phase, twinkle rate, swell spread, unit x, y, z, drift tangent x, z.
 */
function buildSpecks(random: Random) {
  const TAU = Math.PI * 2;
  const specks: number[] = [];
  for (let i = 0; i < 380; i++) {
    const shell = pickSpeckShell(random);
    const latitude = Math.asin(random() * 2 - 1);
    const longitude = random() * TAU;
    specks.push(
      shell,
      zoneOfShell(shell),
      random() * TAU,
      0.6 + random() * 3,
      random(),
      Math.cos(latitude) * Math.cos(longitude),
      Math.sin(latitude),
      Math.cos(latitude) * Math.sin(longitude),
      -Math.sin(longitude) * Math.cos(latitude),
      Math.cos(longitude) * Math.cos(latitude),
    );
  }
  return specks;
}

/** 2D rim rings: prebuilt dashed paths animated by canvas transforms. Dashes in degrees. */
function buildRimRings(random: Random) {
  const radii = [0.8, 0.855, 0.9, 0.94, 0.975, 1.01];
  const zones = [1, 2, 2, 3, 4, 4];
  const rings: {
    radius: number;
    squash: number;
    tilt: number;
    speed: number;
    zone: number;
    width: number;
    dashes: number[];
  }[] = [];
  for (let i = 0; i < radii.length; i++) {
    const dashes: number[] = [];
    let startDegrees = random() * 40;
    while (startDegrees < 350) {
      const lengthDegrees = 1.5 + random() ** 2 * 16;
      dashes.push(startDegrees, Math.min(lengthDegrees, 360 - startDegrees));
      startDegrees += lengthDegrees + 1.5 + random() * 14;
    }
    rings.push({
      radius: radii[i],
      squash: 0.9 + random() * 0.1,
      tilt: random() * 180,
      speed: (random() < 0.5 ? -1 : 1) * (6 + random() * 12),
      zone: zones[i],
      width: 0.8 + random() * 1.2,
      dashes,
    });
  }
  return rings;
}

/** Tilted dashed orbital rings (3D), kept on the sphere. Dashes as [start, length] in radians. */
function buildOrbitalRings(random: Random) {
  const TAU = Math.PI * 2;
  const layouts = [
    { radius: 0.97, tiltX: 1.3, tiltZ: 0.35, speed: 0.22, zone: 2, gap: 0.3 },
    { radius: 1.0, tiltX: 0.2, tiltZ: -0.5, speed: -0.16, zone: 3, gap: 0.35 },
    { radius: 0.9, tiltX: 0.85, tiltZ: 1.1, speed: -0.09, zone: 1, gap: 0.45 },
  ];
  return layouts.map((layout) => {
    const dashes: number[] = [];
    let angle = random() * 0.3;
    while (angle < TAU - 0.1) {
      const length = Math.min(0.04 + random() ** 1.6 * 0.3, TAU - angle);
      dashes.push(angle, length);
      angle += length + 0.04 + random() * layout.gap;
    }
    return {
      radius: layout.radius,
      tiltX: layout.tiltX,
      tiltZ: layout.tiltZ,
      speed: layout.speed,
      zone: layout.zone,
      dashes,
    };
  });
}

/** Broken edge spikes (sparse, long). Stride 4: base angle (0 = top), length jitter, start radius, band offset. */
function buildCrownSpikes(random: Random) {
  const TAU = Math.PI * 2;
  const spikeCount = 22;
  const spikes: number[] = [];
  for (let i = 0; i < spikeCount; i++) {
    spikes.push(
      ((i + (random() - 0.5) * 0.8) / spikeCount) * TAU,
      0.25 + random() * 0.75,
      0.94 + random() * 0.08,
      (random() - 0.5) * 4,
    );
  }
  return spikes;
}

// Glass panels, stride 8: x, y, z, width, height, orientation (0 facing, 1 side-on), first line, line count.
// Panel data lines, stride 4: y fraction, start fraction, length fraction, reveal id.

function pushPanel(
  panels: number[],
  panelLines: number[],
  random: Random,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  side: number,
) {
  const firstLine = panelLines.length / 4;
  const lineCount = 2 + Math.floor(random() * 4);
  for (let k = 0; k < lineCount; k++) {
    const startFraction = random() * 0.55;
    panelLines.push(
      (k + 0.5 + (random() - 0.5) * 0.4) / lineCount,
      startFraction,
      0.08 + random() * Math.min(0.4, 0.95 - startFraction - 0.08),
      random(),
    );
  }
  panels.push(x, y, z, width, height, side, firstLine, lineCount);
}

/** A random panel centre that keeps the panel out of the core (up to 200 tries, else the last try). */
function placePanel(random: Random, width: number, height: number): [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  let tries = 0;
  do {
    x = (random() - 0.5) * 1.5;
    y = (random() - 0.5) * 1.5;
    z = (random() - 0.7) * 1.0; // mostly behind the gold
    // keep the whole panel out of the core: its nearest point must be >= ~0.35 from the centre
    const nearestX = Math.max(0, Math.abs(x) - width / 2);
    const nearestY = Math.max(0, Math.abs(y) - height / 2);
    if (x * x + y * y + z * z <= 0.62 && nearestX * nearestX + nearestY * nearestY >= 0.12) break;
  } while (++tries < 200);
  return [x, y, z];
}

function buildPanels(random: Random) {
  const panels: number[] = [];
  const panelLines: number[] = [];
  for (let i = 0; i < 9; i++) {
    const tall = random() < 0.45;
    const width = tall ? 0.14 + random() * 0.14 : 0.24 + random() * 0.26;
    const height = tall ? 0.32 + random() * 0.3 : 0.12 + random() * 0.16;
    const [x, y, z] = placePanel(random, width, height);
    const side = random() < 0.3 ? 1 : 0;
    pushPanel(panels, panelLines, random, x, y, z, width, height, side);
  }
  // panels breaking out past the rim, upper right (y up in 3D)
  pushPanel(panels, panelLines, random, 0.72, 0.62, 0.05, 0.3, 0.2, 0);
  pushPanel(panels, panelLines, random, 0.95, 0.36, -0.1, 0.16, 0.34, 0);
  pushPanel(panels, panelLines, random, 0.52, 0.86, 0.0, 0.22, 0.12, 0);
  return { panels, panelLines };
}

/**
 * A few long straight grid lines near the panels. Stride 5: position across, depth z,
 * span start, span end, vertical (1: x = position and y spans; 0: y = position and x spans).
 */
function buildGridLines(random: Random) {
  const gridLines: number[] = [];
  for (let i = 0; i < 4; i++) {
    const vertical = i % 2 === 0 ? 1 : 0;
    const position = (random() < 0.5 ? -1 : 1) * (0.3 + random() * 0.35);
    const depth = -0.2 - random() * 0.4;
    const spanStart = -0.2 - random() * 0.45;
    const spanEnd = 0.1 + random() * 0.5;
    gridLines.push(position, depth, spanStart, spanEnd, vertical);
  }
  return gridLines;
}

/**
 * Core knot: small tilted loops.
 * Stride 9: radius, tiltX, tiltZ, spin, sweep, phase, wobble phase, centre offset x, centre offset y.
 */
function buildKnotLoops(random: Random) {
  const TAU = Math.PI * 2;
  const loops: number[] = [];
  for (let i = 0; i < 8; i++) {
    loops.push(
      (0.04 + random() * 0.18) * 1.1 * (1 - i * 0.05),
      random() * Math.PI,
      random() * Math.PI,
      (random() < 0.5 ? -1 : 1) * (0.8 + random() * 1.8),
      1.6 + random() * 2.4,
      random() * TAU,
      random() * TAU,
      -0.02 + (i / 7) * 0.1 + (random() - 0.5) * 0.04,
      (random() - 0.5) * 0.07,
    );
  }
  return loops;
}

/** Horizontal data streaks from the core, 8 rightward and 2 short leftward. Stride 5: y offset, start x, length, phase, speed. */
function buildDataStreaks(random: Random) {
  const TAU = Math.PI * 2;
  const streaks: number[] = [];
  for (let i = 0; i < 10; i++) {
    const rightward = i < 8;
    streaks.push(
      (random() - 0.5) * 0.16,
      rightward ? 0.02 + random() * 0.14 : -0.03 - random() * 0.05,
      rightward ? 0.35 + random() * 0.45 : -(0.06 + random() * 0.1),
      random() * TAU,
      0.3 + random() * 0.9,
    );
  }
  return streaks;
}

/** Screen angle of a rim comb in degrees, densest at 7-11 o'clock and the bottom. */
function pickCombDegrees(random: Random) {
  const roll = random();
  if (roll < 0.62) return 120 + random() * 120;
  if (roll < 0.84) return 55 + random() * 65;
  return random() * 360;
}

/**
 * Rim combs and circuit traces, packed into the 0.72..1.05 shell.
 * Stride 6: screen angle (0 = right, y down), base radius, type (0 comb, 1 circuit trace), then
 *   comb:  tooth count, tooth gap, first tooth (index into teeth, which holds tooth lengths)
 *   trace: jog, bend radius, end radius
 */
function buildRimCombs(random: Random) {
  const combs: number[] = [];
  const teeth: number[] = [];
  for (let i = 0; i < 26; i++) {
    const angle = (pickCombDegrees(random) * Math.PI) / 180;
    if (random() < 0.68) {
      const toothCount = 3 + Math.floor(random() * 5);
      const firstTooth = teeth.length;
      const baseRadius = 0.72 + random() * 0.16;
      for (let k = 0; k < toothCount; k++) teeth.push(0.03 + random() ** 1.5 * (1.04 - baseRadius) * 0.95);
      combs.push(angle, baseRadius, 0, toothCount, 0.011 + random() * 0.012, firstTooth);
    } else {
      const startRadius = 0.74 + random() * 0.12;
      combs.push(
        angle,
        startRadius,
        1,
        (random() - 0.5) * 0.07,
        startRadius + 0.04 + random() * 0.08,
        0.95 + random() * 0.1,
      );
    }
  }
  return { combs, teeth };
}

/** Ladder: rail width; circuit: tangential jog; hanging comb: bar width. */
function pickStrutWidthOrJog(random: Random, type: number) {
  if (type === 0) return 0.022 + random() * 0.02;
  if (type === 1) return (random() - 0.5) * 0.08;
  return 0.06 + random() * 0.06;
}

/**
 * Protruding struts that break the silhouette: ladders, circuit traces with pads, hanging combs.
 * Weighted to 7-8 o'clock, the bottom (6 o'clock) and a frayed upper left.
 * Stride 7: screen angle (0 = right, y down), type (0 ladder, 1 circuit, 2 hanging comb),
 * start radius, end radius, width or jog, count, seed.
 */
function buildStruts(random: Random) {
  // [screen angle in degrees, type]
  const layout = [
    [118, 0],
    [132, 1],
    [141, 0],
    [152, 2],
    [163, 0],
    [84, 2],
    [97, 1],
    [216, 0],
    [232, 1],
    [58, 1],
  ];
  const struts: number[] = [];
  for (const [degrees, type] of layout) {
    const angle = ((degrees + (random() - 0.5) * 8) * Math.PI) / 180;
    const startRadius = 0.86 + random() * 0.1;
    const endRadius = (degrees > 200 || degrees < 70 ? 1.1 : 1.15) + random() * 0.1;
    const widthOrJog = pickStrutWidthOrJog(random, type);
    struts.push(angle, type, startRadius, endRadius, widthOrJog, 3 + Math.floor(random() * 4), random());
  }
  return struts;
}

/** Keeps the worklet copy of the scene small. */
function roundToFiveDecimals(value: number) {
  return Math.round(value * 1e5) / 1e5;
}

/** Builds the hologram's random geometry once. Deterministic for a given seed; plain data only. */
export function createHologramScene(seed: number) {
  const random = createRandom(seed);
  const fragmentSpecs: number[] = [];
  pushBrokenArcs(fragmentSpecs, random);
  pushRimRibs(fragmentSpecs, random);
  pushDataDashes(fragmentSpecs, random);
  const fragments = buildFragmentGeometry(fragmentSpecs);
  const specks = buildSpecks(random);
  const rimRings = buildRimRings(random);
  const orbitalRings = buildOrbitalRings(random);
  const crownSpikes = buildCrownSpikes(random);
  const { panels, panelLines } = buildPanels(random);
  const gridLines = buildGridLines(random);
  const knotLoops = buildKnotLoops(random);
  const dataStreaks = buildDataStreaks(random);
  const { combs, teeth } = buildRimCombs(random);
  const struts = buildStruts(random);
  return {
    fragments: fragments.map(roundToFiveDecimals),
    specks: specks.map(roundToFiveDecimals),
    rimRings,
    orbitalRings,
    crownSpikes: crownSpikes.map(roundToFiveDecimals),
    rimCombs: combs.map(roundToFiveDecimals),
    combTeeth: teeth.map(roundToFiveDecimals),
    struts: struts.map(roundToFiveDecimals),
    panels: panels.map(roundToFiveDecimals),
    panelLines: panelLines.map(roundToFiveDecimals),
    gridLines: gridLines.map(roundToFiveDecimals),
    knotLoops: knotLoops.map(roundToFiveDecimals),
    dataStreaks: dataStreaks.map(roundToFiveDecimals),
  };
}

type Scene = ReturnType<typeof createHologramScene>;

// ---- resources: Skia objects built once per mounted canvas --------------------------------

/** Paints, gradient shaders, prebuilt rim ring paths and the reusable path builders. */
export function createHologramResources(Skia: SkiaApiType, scene: Scene) {
  const makeStroke = (color: string, strokeCap: StrokeCap) => {
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setStyle(PaintStyle.Stroke);
    paint.setColor(Skia.Color(color));
    paint.setBlendMode(BlendMode.Screen);
    paint.setStrokeCap(strokeCap);
    return paint;
  };
  const makeRadialGradient = (colors: string[], positions: number[]) =>
    Skia.Shader.MakeRadialGradient(
      { x: 0, y: 0 },
      1,
      colors.map((color) => Skia.Color(color)),
      positions,
      TileMode.Clamp,
    );
  // Depth by screen radius: on the back hemisphere a fragment near the centre is
  // far away (dim); on the front it is near (brighter); both meet at the limb, so
  // a fragment crossing the limb changes bucket with no visible step.
  const makeDepthStroke = (baseColor: string, front: boolean, strokeCap: StrokeCap) => {
    const paint = makeStroke('#ffffff', strokeCap);
    const centreAlpha = front ? 'd0' : '50';
    const middleAlpha = front ? 'f0' : '98';
    const limbAlpha = front ? 'ff' : 'e0';
    paint.setShader(
      makeRadialGradient(
        [
          `${baseColor}${centreAlpha}`,
          `${baseColor}${middleAlpha}`,
          `${baseColor}${limbAlpha}`,
          `${baseColor}${limbAlpha}`,
        ],
        [0, 0.55, 0.84, 1],
      ),
    );
    return paint;
  };
  const glowStroke = makeStroke('#e8862a', StrokeCap.Round);
  const lineStroke = makeStroke('#f7a83c', StrokeCap.Round);
  const dashStroke = makeStroke('#f8ae44', StrokeCap.Butt);
  const paleGoldStroke = makeStroke('#ffe6b0', StrokeCap.Round);
  const warmWhiteStroke = makeStroke('#fff0d4', StrokeCap.Round);
  const sparkStroke = makeStroke('#f8c878', StrokeCap.Square);
  const frontGlowStroke = makeDepthStroke('#e8862a', true, StrokeCap.Round);
  const frontLineStroke = makeDepthStroke('#f7a83c', true, StrokeCap.Round);
  const backLineStroke = makeDepthStroke('#e89a3c', false, StrokeCap.Round);
  const frontDashStroke = makeDepthStroke('#f8ae44', true, StrokeCap.Butt);
  const backDashStroke = makeDepthStroke('#e89a3c', false, StrokeCap.Butt);
  const frontSpeckStroke = makeDepthStroke('#fbbd5a', true, StrokeCap.Square);
  const backSpeckStroke = makeDepthStroke('#e8a048', false, StrokeCap.Square);

  // cool blue-lavender glass panels
  const panelFill = Skia.Paint();
  panelFill.setAntiAlias(true);
  panelFill.setStyle(PaintStyle.Fill);
  panelFill.setBlendMode(BlendMode.Screen);
  panelFill.setColor(Skia.Color('#7a8ed4'));
  const panelEdgeStroke = makeStroke('#a8b6ec', StrokeCap.Butt);

  const makeDiscFill = (colors: string[], positions: number[]) => {
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setBlendMode(BlendMode.Screen);
    paint.setShader(makeRadialGradient(colors, positions));
    return paint;
  };
  // warm gold core bloom, no white-hot centre
  const coreBloomFill = makeDiscFill(
    ['#ffe2a0bf', '#ffd690a8', '#f8c06880', '#f0a04040', '#d8802c0e', '#c0601000'],
    [0, 0.1, 0.25, 0.44, 0.7, 1],
  );
  // faint interior warmth only: peaks well inside the limb, nothing smooth at the edge
  const interiorWarmthFill = makeDiscFill(
    ['#e0801c00', '#e0801c05', '#e0801c0a', '#e0801c0e', '#e0801c04', '#e0801c00'],
    [0, 0.25, 0.55, 0.72, 0.84, 0.9],
  );
  // travelling brightness wave around the rim: a sweep gradient peaked at angle 0, rotated by the canvas
  const rimWaveStroke = Skia.Paint();
  rimWaveStroke.setAntiAlias(true);
  rimWaveStroke.setStyle(PaintStyle.Stroke);
  rimWaveStroke.setBlendMode(BlendMode.Screen);
  rimWaveStroke.setShader(
    Skia.Shader.MakeSweepGradient(
      0,
      0,
      ['#e8943aff', '#e0902e66', '#d8801c00', '#d8801c00', '#e0902e66', '#e8943aff'].map((color) => Skia.Color(color)),
      [0, 0.06, 0.15, 0.85, 0.94, 1],
      TileMode.Clamp,
    ),
  );

  // Prebuilt rim ring paths in unit space (radius 1), scaled per ring at draw time.
  const rimPaths = scene.rimRings.map((ring) => {
    const builder = Skia.PathBuilder.Make();
    for (let k = 0; k < ring.dashes.length; k += 2) {
      builder.addArc({ x: -1, y: -1, width: 2, height: 2 }, ring.dashes[k], ring.dashes[k + 1]);
    }
    return builder.build();
  });

  // Reused path builders, one per batch of strokes that share a paint.
  const makeBuilder = () => Skia.PathBuilder.Make();
  const pathBuilders = {
    panelFillFront: makeBuilder(),
    panelFillBack: makeBuilder(),
    panelOutlines: makeBuilder(), // panel edges and grid lines
    panelData: makeBuilder(),
    // outer frame, by rim group and hemisphere: [low-mid back, low-mid front, high back, high front]
    shellArcs: [makeBuilder(), makeBuilder(), makeBuilder(), makeBuilder()],
    shellDashes: [makeBuilder(), makeBuilder(), makeBuilder(), makeBuilder()],
    innerArcs: makeBuilder(),
    innerDashes: makeBuilder(),
    crown: makeBuilder(),
    crownTips: makeBuilder(),
    knot: makeBuilder(),
    crescentTiers: [makeBuilder(), makeBuilder(), makeBuilder()], // thin, medium, wide
    streakTiers: [makeBuilder(), makeBuilder(), makeBuilder()], // bright, fading, faint
    ringBack: makeBuilder(),
    ringFrontOuter: makeBuilder(),
    ringFrontInner: makeBuilder(),
    speckBack: makeBuilder(),
    speckFront: makeBuilder(),
    sparks: makeBuilder(),
    hotSparks: makeBuilder(),
  };
  // one flat list, so the frame can reset them all first
  const allPathBuilders = [
    pathBuilders.panelFillFront,
    pathBuilders.panelFillBack,
    pathBuilders.panelOutlines,
    pathBuilders.panelData,
    ...pathBuilders.shellArcs,
    ...pathBuilders.shellDashes,
    pathBuilders.innerArcs,
    pathBuilders.innerDashes,
    pathBuilders.crown,
    pathBuilders.crownTips,
    pathBuilders.knot,
    ...pathBuilders.crescentTiers,
    ...pathBuilders.streakTiers,
    pathBuilders.ringBack,
    pathBuilders.ringFrontOuter,
    pathBuilders.ringFrontInner,
    pathBuilders.speckBack,
    pathBuilders.speckFront,
    pathBuilders.sparks,
    pathBuilders.hotSparks,
  ];

  return {
    glowStroke,
    lineStroke,
    dashStroke,
    paleGoldStroke,
    warmWhiteStroke,
    sparkStroke,
    frontGlowStroke,
    frontLineStroke,
    backLineStroke,
    frontDashStroke,
    backDashStroke,
    frontSpeckStroke,
    backSpeckStroke,
    panelFill,
    panelEdgeStroke,
    coreBloomFill,
    interiorWarmthFill,
    rimWaveStroke,
    rimPaths,
    pathBuilders,
    allPathBuilders,
  };
}

type Resources = ReturnType<typeof createHologramResources>;
type PathBuilders = Resources['pathBuilders'];
type PathBuilder = ReturnType<SkiaApiType['PathBuilder']['Make']>;

/** Per-frame scratch arrays, written before every read. */
interface Scratch {
  /** 3×3 rotation matrix for panels, orbital rings, the C and the knot (used in turn). */
  rotation: number[];
  pointA: number[];
  pointB: number[];
  /** Fragment endpoints: start xyz, next xyz (conic control or line end), arc end xyz, conic weight. */
  endpoints: number[];
}

// ---- math and audio helpers (worklets) ----------------------------------------------------

function clamp01(value: number) {
  'worklet';
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Clamps to 0..maximum. */
function limit(value: number, maximum: number) {
  'worklet';
  return value < 0 ? 0 : value > maximum ? maximum : value;
}

/** Rotation matrix = Rz(roll) * Rx(pitch) * Ry(yaw), written into matrix[0..8]. */
function writeRotation(matrix: number[], yaw: number, pitch: number, roll: number) {
  'worklet';
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const cosRoll = Math.cos(roll);
  const sinRoll = Math.sin(roll);
  const sinPitchSinYaw = sinPitch * sinYaw;
  const minusSinPitchCosYaw = -sinPitch * cosYaw;
  matrix[0] = cosRoll * cosYaw - sinRoll * sinPitchSinYaw;
  matrix[1] = -sinRoll * cosPitch;
  matrix[2] = cosRoll * sinYaw - sinRoll * minusSinPitchCosYaw;
  matrix[3] = sinRoll * cosYaw + cosRoll * sinPitchSinYaw;
  matrix[4] = cosRoll * cosPitch;
  matrix[5] = sinRoll * sinYaw + cosRoll * minusSinPitchCosYaw;
  matrix[6] = -cosPitch * sinYaw;
  matrix[7] = sinPitch;
  matrix[8] = cosPitch * cosYaw;
}

/** Rotates by matrix and projects with mild perspective into unit space; out = [x, y, depth]. */
function projectPoint(out: number[], matrix: number[], x: number, y: number, z: number) {
  'worklet';
  const rotatedX = matrix[0] * x + matrix[1] * y + matrix[2] * z;
  const rotatedY = matrix[3] * x + matrix[4] * y + matrix[5] * z;
  const rotatedZ = matrix[6] * x + matrix[7] * y + matrix[8] * z;
  const perspective = 3.6 / (3.6 - rotatedZ);
  out[0] = rotatedX * perspective;
  out[1] = -rotatedY * perspective;
  out[2] = rotatedZ;
}

/** Mean of bands[firstBand..endBand) times gain, clamped to 0..1. */
function bandAverage(bands: number[], firstBand: number, endBand: number, gain: number) {
  'worklet';
  let sum = 0;
  let count = 0;
  for (let i = firstBand; i < endBand && i < bands.length; i++) {
    sum += bands[i];
    count++;
  }
  return count ? clamp01((sum / count) * gain) : 0;
}

/** Interpolated band at a fractional index, with extra gain for higher bands (speech is low-heavy). */
function bandAtPosition(bands: number[], position: number) {
  'worklet';
  const bandCount = bands.length;
  if (bandCount === 0) return 0;
  const clamped = position < 0 ? 0 : position > bandCount - 1 ? bandCount - 1 : position;
  const index = Math.floor(clamped);
  const fraction = clamped - index;
  const value = bands[index] * (1 - fraction) + bands[index + 1 < bandCount ? index + 1 : bandCount - 1] * fraction;
  return clamp01(value * (1 + (1.6 * clamped) / bandCount));
}

/** Band for a fraction of a turn from the top: lows at the top, highs at the bottom, mirrored. */
function mirroredBand(bands: number[], turn: number, offset: number) {
  'worklet';
  const mirrored = turn < 0.5 ? 2 * turn : 2 - 2 * turn;
  return bandAtPosition(bands, mirrored * (bands.length - 1) + offset);
}

/** Band magnitude for a screen angle (0 = right, y down): lows at the top, highs at the bottom, mirrored. */
function bandForScreenAngle(bands: number[], angle: number) {
  'worklet';
  const TAU = Math.PI * 2;
  const turn = ((((angle + Math.PI / 2) / TAU) % 1) + 1) % 1;
  return mirroredBand(bands, turn, 0);
}

/** A radial segment at screen direction (cosAngle, sinAngle), shifted tangentially, from startRadius to endRadius. */
function appendRadialSegment(
  builder: PathBuilder,
  cosAngle: number,
  sinAngle: number,
  tangentialOffset: number,
  startRadius: number,
  endRadius: number,
) {
  'worklet';
  builder.moveTo(
    cosAngle * startRadius - sinAngle * tangentialOffset,
    sinAngle * startRadius + cosAngle * tangentialOffset,
  );
  builder.lineTo(
    cosAngle * endRadius - sinAngle * tangentialOffset,
    sinAngle * endRadius + cosAngle * tangentialOffset,
  );
}

/**
 * A 3D circle arc (or a spiral, when the radii differ) in the plane y = 0 of the rotation
 * matrix, centred at the unit offset (offsetX, offsetY), appended as conics of at most 0.55 rad.
 */
function appendProjectedArc(
  builder: PathBuilder,
  matrix: number[],
  startRadius: number,
  endRadius: number,
  startAngle: number,
  sweep: number,
  offsetX: number,
  offsetY: number,
  endPoint: number[],
  controlPoint: number[],
) {
  'worklet';
  const pieces = sweep > 0.55 ? Math.ceil(sweep / 0.55) : 1;
  const step = sweep / pieces;
  const halfStep = step * 0.5;
  const weight = Math.cos(halfStep);
  projectPoint(endPoint, matrix, Math.cos(startAngle) * startRadius, 0, Math.sin(startAngle) * startRadius);
  builder.moveTo(endPoint[0] + offsetX, endPoint[1] + offsetY);
  for (let piece = 0; piece < pieces; piece++) {
    const pieceStart = startAngle + step * piece;
    const middleRadius = startRadius + ((endRadius - startRadius) * (piece + 0.5)) / pieces;
    const pieceEndRadius = startRadius + ((endRadius - startRadius) * (piece + 1)) / pieces;
    projectPoint(
      controlPoint,
      matrix,
      (Math.cos(pieceStart + halfStep) * middleRadius) / weight,
      0,
      (Math.sin(pieceStart + halfStep) * middleRadius) / weight,
    );
    projectPoint(
      endPoint,
      matrix,
      Math.cos(pieceStart + step) * pieceEndRadius,
      0,
      Math.sin(pieceStart + step) * pieceEndRadius,
    );
    builder.conicTo(
      controlPoint[0] + offsetX,
      controlPoint[1] + offsetY,
      endPoint[0] + offsetX,
      endPoint[1] + offsetY,
      weight,
    );
  }
}

/** Everything a frame derives from time and voice; see the file header for the mapping. */
function analyseFrame(frame: HologramFrame, size: number) {
  'worklet';
  const TAU = Math.PI * 2;
  const time = frame.time;
  // listening with residual level reacts a little less than speaking (no step at level 0)
  const speakingScale = frame.speaking ? 1 : 0.8;
  const level = clamp01(frame.level) * speakingScale;
  const energy = level ** 0.8; // perceptual energy: keeps loud troughs clearly above soft
  const bands = frame.bands;

  // zones by radius: 0 = lows / inner, 4 = highs / outer rim
  const bassEnergy = bandAverage(bands, 0, 5, 1.1) * speakingScale;
  const zoneEnergy = [
    bassEnergy,
    bandAverage(bands, 5, 9, 1.3) * speakingScale,
    bandAverage(bands, 9, 13, 1.8) * speakingScale,
    bandAverage(bands, 13, 18, 2.6) * speakingScale,
    bandAverage(bands, 18, 24, 3.5) * speakingScale,
  ];
  // how far each zone's unsplit arcs grow at both ends, as cos/sin of the extra angle
  const sweepCos = [1, 1, 1, 1, 1];
  const sweepSin = [0, 0, 0, 0, 0];
  for (let zone = 0; zone < 5; zone++) {
    const extension = 0.2 * zoneEnergy[zone] + 0.02 * energy;
    sweepCos[zone] = Math.cos(extension);
    sweepSin[zone] = Math.sin(extension);
  }

  const breathe = 1 + 0.02 * Math.sin(time * 1.1);
  const radius = size * 0.335 * breathe * (1 + 0.025 * energy + 0.012 * bassEnergy);
  const pitch = 0.36 + 0.06 * Math.sin(time * 0.23);
  const roll = -0.2 + 0.04 * Math.sin(time * 0.17);
  const outerRotation = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const innerRotation = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  writeRotation(outerRotation, time * 0.26, pitch, roll);
  writeRotation(innerRotation, -time * 0.38 + 0.8, pitch + 0.2, roll - 0.25);

  return {
    time,
    speakingScale,
    energy,
    bands,
    bassEnergy,
    zoneEnergy,
    sweepCos,
    sweepSin,
    midEnergy: bandAverage(bands, 5, 14, 1.6) * speakingScale,
    highEnergy: bandAverage(bands, 14, 24, 3) * speakingScale,
    // the outer frame's two rim groups: zones 1-2 (low-mid) and 3-4 (high)
    lowMidRimEnergy: 0.5 * (zoneEnergy[1] + zoneEnergy[2]),
    highRimEnergy: 0.5 * (zoneEnergy[3] + zoneEnergy[4]),
    radius,
    pixel: size / 720 / radius, // one 720-space pixel in unit space
    glowGain: 1 + 0.25 * energy, // only for glow / haze passes
    heartbeat: 1 + 0.05 * Math.sin(time * TAU * 0.4),
    // listening: panels a little more present
    panelPresence: 1 + 0.6 * (1 - speakingScale) * 5 * clamp01(frame.level),
    pitch,
    roll,
    outerRotation,
    innerRotation,
  };
}

type FrameState = ReturnType<typeof analyseFrame>;

// ---- layers (worklets), in drawing order ------------------------------------------------

/** Faint interior warmth (no limb halo). */
function drawInteriorWarmth(canvas: HologramCanvas, resources: Resources, state: FrameState) {
  'worklet';
  resources.interiorWarmthFill.setAlphaf(clamp01((0.6 + 0.5 * state.midEnergy) * state.glowGain));
  canvas.drawCircle(-0.015, 0.02, 1, resources.interiorWarmthFill);
}

/** Travelling brightness wave around the rim, alive even when silent. */
function drawRimWave(canvas: HologramCanvas, resources: Resources, state: FrameState) {
  'worklet';
  const TAU = Math.PI * 2;
  const time = state.time;
  canvas.save();
  canvas.rotate(((time * 0.55) % TAU) * (180 / Math.PI) + 40 * Math.sin(time * 0.2), 0, 0);
  resources.rimWaveStroke.setStrokeWidth(0.2);
  resources.rimWaveStroke.setAlphaf(clamp01((0.08 + 0.08 * state.highRimEnergy) * state.glowGain));
  canvas.drawCircle(0, 0, 0.85, resources.rimWaveStroke);
  canvas.restore();
}

/** A panel point offset from its centre: across its width and up its height, facing or side-on. */
function projectPanelPoint(
  out: number[],
  matrix: number[],
  x: number,
  y: number,
  z: number,
  across: number,
  up: number,
  side: boolean,
) {
  'worklet';
  if (side) projectPoint(out, matrix, x, y + up, z + across);
  else projectPoint(out, matrix, x + across, y + up, z);
}

/** One glass panel: its quad into a fill builder and the outline builder, then its data lines. */
function appendGlassPanel(
  builders: PathBuilders,
  matrix: number[],
  scratch: Scratch,
  panels: number[],
  panelLines: number[],
  offset: number,
  state: FrameState,
  reveal: number,
) {
  'worklet';
  const time = state.time;
  const x = panels[offset];
  const y = panels[offset + 1] + 0.02 * Math.sin(time * 0.3 + offset);
  const z = panels[offset + 2];
  const halfWidth = panels[offset + 3] * 0.5 * (1 + 0.12 * state.midEnergy);
  const halfHeight = panels[offset + 4] * 0.5;
  const side = panels[offset + 5] > 0.5;
  const fill = z < -0.15 ? builders.panelFillBack : builders.panelFillFront;
  const outlines = builders.panelOutlines;
  const pointA = scratch.pointA;
  const pointB = scratch.pointB;

  projectPanelPoint(pointA, matrix, x, y, z, -halfWidth, -halfHeight, side);
  fill.moveTo(pointA[0], pointA[1]);
  outlines.moveTo(pointA[0], pointA[1]);
  const firstCornerX = pointA[0];
  const firstCornerY = pointA[1];
  for (let corner = 1; corner < 4; corner++) {
    const across = corner === 3 ? -halfWidth : halfWidth;
    const up = corner < 2 ? -halfHeight : halfHeight;
    projectPanelPoint(pointA, matrix, x, y, z, across, up, side);
    fill.lineTo(pointA[0], pointA[1]);
    outlines.lineTo(pointA[0], pointA[1]);
  }
  fill.close();
  outlines.lineTo(firstCornerX, firstCornerY);

  const firstLine = panels[offset + 6];
  const lineCount = panels[offset + 7];
  for (let k = 0; k < lineCount; k++) {
    const lineOffset = (firstLine + k) * 4;
    const visibility = clamp01((panelLines[lineOffset + 3] - 0.55 + reveal * 1.4) * 3);
    const length =
      panelLines[lineOffset + 2] * (0.45 + 0.55 * visibility) * (0.85 + 0.15 * Math.sin(time * 0.9 + lineOffset));
    const up = -halfHeight + panelLines[lineOffset] * 2 * halfHeight;
    const startAcross = -halfWidth + panelLines[lineOffset + 1] * 2 * halfWidth;
    const endAcross = startAcross + length * 2 * halfWidth;
    projectPanelPoint(pointA, matrix, x, y, z, startAcross, up, side);
    projectPanelPoint(pointB, matrix, x, y, z, endAcross, up, side);
    builders.panelData.moveTo(pointA[0], pointA[1]);
    builders.panelData.lineTo(pointB[0], pointB[1]);
  }
}

function appendGridLines(outlines: PathBuilder, matrix: number[], scratch: Scratch, gridLines: number[]) {
  'worklet';
  const pointA = scratch.pointA;
  const pointB = scratch.pointB;
  for (let offset = 0; offset < gridLines.length; offset += 5) {
    const position = gridLines[offset];
    const depth = gridLines[offset + 1];
    const spanStart = gridLines[offset + 2];
    const spanEnd = gridLines[offset + 3];
    if (gridLines[offset + 4] > 0.5) {
      projectPoint(pointA, matrix, position, spanStart, depth);
      projectPoint(pointB, matrix, position, spanEnd, depth);
    } else {
      projectPoint(pointA, matrix, spanStart, position, depth);
      projectPoint(pointB, matrix, spanEnd, position, depth);
    }
    outlines.moveTo(pointA[0], pointA[1]);
    outlines.lineTo(pointB[0], pointB[1]);
  }
}

/** Glass panels and grid lines: translucent, cool, mostly behind the gold. */
function drawGlassPanels(
  canvas: HologramCanvas,
  resources: Resources,
  scene: Scene,
  state: FrameState,
  scratch: Scratch,
) {
  'worklet';
  const time = state.time;
  const midEnergy = state.midEnergy;
  const builders = resources.pathBuilders;
  const matrix = scratch.rotation;
  writeRotation(matrix, 0.35 * Math.sin(time * 0.11) + 0.1, 0.1 * Math.sin(time * 0.07), -0.05);
  const panels = scene.panels;
  const reveal = 0.55 * midEnergy + 0.1 * state.energy;
  for (let offset = 0; offset < panels.length; offset += 8) {
    appendGlassPanel(builders, matrix, scratch, panels, scene.panelLines, offset, state, reveal);
  }
  appendGridLines(builders.panelOutlines, matrix, scratch, scene.gridLines);

  const fillAlpha = limit((0.19 + 0.06 * midEnergy) * state.panelPresence, 0.32);
  resources.panelFill.setAlphaf(fillAlpha);
  canvas.drawPath(builders.panelFillFront.detach(), resources.panelFill);
  resources.panelFill.setAlphaf(fillAlpha * 0.55);
  canvas.drawPath(builders.panelFillBack.detach(), resources.panelFill);
  resources.panelEdgeStroke.setStrokeWidth(1 * state.pixel);
  resources.panelEdgeStroke.setAlphaf(limit((0.18 + 0.06 * midEnergy) * state.panelPresence, 0.3));
  canvas.drawPath(builders.panelOutlines.detach(), resources.panelEdgeStroke);
  const dataPath = builders.panelData.detach();
  resources.glowStroke.setStrokeWidth(5 * state.pixel);
  resources.glowStroke.setAlphaf(clamp01((0.04 + 0.06 * midEnergy) * state.glowGain));
  canvas.drawPath(dataPath, resources.glowStroke);
  resources.dashStroke.setStrokeWidth((2.4 + 1 * midEnergy) * state.pixel);
  resources.dashStroke.setAlphaf(limit(0.55 + 0.3 * midEnergy, 0.85));
  canvas.drawPath(dataPath, resources.dashStroke);
}

/** A latitude or longitude arc grown by the zone's extra angle at both ends: exact on the circle, no trig per arc. */
function writeGrownArcEndpoints(
  endpoints: number[],
  geometry: number[],
  offset: number,
  scale: number,
  sweepCos: number,
  sweepSin: number,
) {
  'worklet';
  const weight = geometry[offset + 15];
  const sinHalfSweep = geometry[offset + 16];
  const centreY = geometry[offset + 17];
  // start, middle and end relative to the circle's centre
  const startX = geometry[offset + 6];
  const startY = geometry[offset + 7] - centreY;
  const startZ = geometry[offset + 8];
  const middleX = geometry[offset + 9] * weight;
  const middleY = (geometry[offset + 10] - centreY) * weight;
  const middleZ = geometry[offset + 11] * weight;
  const endX = geometry[offset + 12];
  const endY = geometry[offset + 13] - centreY;
  const endZ = geometry[offset + 14];
  const inverseSinHalfSweep = 1 / sinHalfSweep;
  // tangents at the start and the end
  const startTangentX = (middleX - startX * weight) * inverseSinHalfSweep;
  const startTangentY = (middleY - startY * weight) * inverseSinHalfSweep;
  const startTangentZ = (middleZ - startZ * weight) * inverseSinHalfSweep;
  const endTangentX = (endX * weight - middleX) * inverseSinHalfSweep;
  const endTangentY = (endY * weight - middleY) * inverseSinHalfSweep;
  const endTangentZ = (endZ * weight - middleZ) * inverseSinHalfSweep;
  const grownWeight = weight * sweepCos - sinHalfSweep * sweepSin;
  const inverseGrownWeight = 1 / grownWeight;
  endpoints[0] = (startX * sweepCos - startTangentX * sweepSin) * scale;
  endpoints[1] = (centreY + startY * sweepCos - startTangentY * sweepSin) * scale;
  endpoints[2] = (startZ * sweepCos - startTangentZ * sweepSin) * scale;
  endpoints[3] = middleX * inverseGrownWeight * scale;
  endpoints[4] = (centreY + middleY * inverseGrownWeight) * scale;
  endpoints[5] = middleZ * inverseGrownWeight * scale;
  endpoints[6] = (endX * sweepCos + endTangentX * sweepSin) * scale;
  endpoints[7] = (centreY + endY * sweepCos + endTangentY * sweepSin) * scale;
  endpoints[8] = (endZ * sweepCos + endTangentZ * sweepSin) * scale;
  endpoints[9] = grownWeight;
}

/** Writes a fragment's scaled 3D endpoints (see Scratch.endpoints) for its type. */
function writeFragmentEndpoints(
  endpoints: number[],
  geometry: number[],
  offset: number,
  scale: number,
  visibility: number,
  zoneEnergy: number,
  zone: number,
  state: FrameState,
) {
  'worklet';
  const type = geometry[offset];
  if (type === 0) {
    if (geometry[offset + 16] > 0 && state.sweepSin[zone] > 0.002) {
      writeGrownArcEndpoints(endpoints, geometry, offset, scale, state.sweepCos[zone], state.sweepSin[zone]);
      return;
    }
    for (let i = 0; i < 9; i++) endpoints[i] = geometry[offset + 6 + i] * scale;
    endpoints[9] = geometry[offset + 15];
  } else if (type === 1) {
    // short dash: a chord that lengthens as it is revealed
    const halfLength = scale * (0.35 + 0.65 * visibility);
    const middleX = geometry[offset + 6] * scale;
    const middleY = geometry[offset + 7] * scale;
    const middleZ = geometry[offset + 8] * scale;
    endpoints[0] = middleX - geometry[offset + 9] * halfLength;
    endpoints[1] = middleY - geometry[offset + 10] * halfLength;
    endpoints[2] = middleZ - geometry[offset + 11] * halfLength;
    endpoints[3] = middleX + geometry[offset + 9] * halfLength;
    endpoints[4] = middleY + geometry[offset + 10] * halfLength;
    endpoints[5] = middleZ + geometry[offset + 11] * halfLength;
  } else {
    // radial tick
    const chunkyGain = geometry[offset + 4] > 0.5 ? 0.8 : 1.2;
    const tipRadius = scale + geometry[offset + 9] * (0.4 + 0.6 * visibility) * (1 + chunkyGain * zoneEnergy);
    for (let i = 0; i < 3; i++) {
      endpoints[i] = geometry[offset + 6 + i] * scale;
      endpoints[3 + i] = geometry[offset + 6 + i] * tipRadius;
    }
  }
}

/** The builder for a fragment: inner frame arcs/dashes, or the outer frame by rim group and hemisphere. */
function pickFragmentBuilder(builders: PathBuilders, inner: boolean, chunky: boolean, zone: number, depth: number) {
  'worklet';
  if (inner) return chunky ? builders.innerDashes : builders.innerArcs;
  const groupBuilders = chunky ? builders.shellDashes : builders.shellArcs;
  return groupBuilders[(zone < 3 ? 0 : 2) + (depth < 0 ? 0 : 1)];
}

/** Rotates and projects a fragment's endpoints (the projection inlined) and appends it as a line or a conic. */
function appendProjectedFragment(
  builders: PathBuilders,
  matrix: number[],
  endpoints: number[],
  isArc: boolean,
  inner: boolean,
  chunky: boolean,
  zone: number,
) {
  'worklet';
  const xFromX = matrix[0];
  const xFromY = matrix[1];
  const xFromZ = matrix[2];
  const yFromX = matrix[3];
  const yFromY = matrix[4];
  const yFromZ = matrix[5];
  const depthFromX = matrix[6];
  const depthFromY = matrix[7];
  const depthFromZ = matrix[8];
  const startX = endpoints[0];
  const startY = endpoints[1];
  const startZ = endpoints[2];
  const nextX = endpoints[3];
  const nextY = endpoints[4];
  const nextZ = endpoints[5];
  let depth = depthFromX * startX + depthFromY * startY + depthFromZ * startZ;
  let perspective = 3.6 / (3.6 - depth);
  const screenStartX = (xFromX * startX + xFromY * startY + xFromZ * startZ) * perspective;
  const screenStartY = -(yFromX * startX + yFromY * startY + yFromZ * startZ) * perspective;
  depth = depthFromX * nextX + depthFromY * nextY + depthFromZ * nextZ;
  perspective = 3.6 / (3.6 - depth);
  const screenNextX = (xFromX * nextX + xFromY * nextY + xFromZ * nextZ) * perspective;
  const screenNextY = -(yFromX * nextX + yFromY * nextY + yFromZ * nextZ) * perspective;
  const builder = pickFragmentBuilder(builders, inner, chunky, zone, depth);
  builder.moveTo(screenStartX, screenStartY);
  if (!isArc) {
    builder.lineTo(screenNextX, screenNextY);
    return;
  }
  const endX = endpoints[6];
  const endY = endpoints[7];
  const endZ = endpoints[8];
  perspective = 3.6 / (3.6 - (depthFromX * endX + depthFromY * endY + depthFromZ * endZ));
  builder.conicTo(
    screenNextX,
    screenNextY,
    (xFromX * endX + xFromY * endY + xFromZ * endZ) * perspective,
    -(yFromX * endX + yFromY * endY + yFromZ * endZ) * perspective,
    endpoints[9],
  );
}

/** Sorts every visible sphere fragment into its builder. */
function appendSphereFragments(builders: PathBuilders, geometry: number[], state: FrameState, endpoints: number[]) {
  'worklet';
  for (let offset = 0; offset < geometry.length; offset += 18) {
    const zone = geometry[offset + 2];
    const inner = geometry[offset + 3] > 0.5;
    const chunky = geometry[offset + 4] > 0.5;
    const zoneEnergy = state.zoneEnergy[zone];
    // voice reveals more of the detail: dash length grows smoothly from a per-element threshold
    const visibility = chunky
      ? clamp01((geometry[offset + 5] - 0.18 + 0.55 * zoneEnergy + 0.08 * state.energy) * 3)
      : 1;
    if (visibility < 0.03) continue;
    const swell = inner ? 0.05 : 0.04 - 0.03 * (zone >> 2);
    const scale = geometry[offset + 1] * (1 + swell * zoneEnergy + 0.01 * state.energy);
    writeFragmentEndpoints(endpoints, geometry, offset, scale, visibility, zoneEnergy, zone, state);
    const matrix = inner ? state.innerRotation : state.outerRotation;
    appendProjectedFragment(builders, matrix, endpoints, geometry[offset] === 0, inner, chunky, zone);
  }
}

/** One rim group of the outer frame: the back hemisphere fine, dim and without glow; the front thicker and glowing. */
function drawShellGroup(
  canvas: HologramCanvas,
  resources: Resources,
  state: FrameState,
  group: number,
  groupEnergy: number,
) {
  'worklet';
  const pixel = state.pixel;
  const builders = resources.pathBuilders;
  const pulse = 1 + 0.14 * Math.sin(state.time * 0.9 + group * 2.9);
  const brightness = (0.85 + 0.7 * groupEnergy) * pulse; // line brightness (capped below)
  // back hemisphere: fine, dim, no glow
  const backArcs = builders.shellArcs[group * 2].detach();
  const backDashes = builders.shellDashes[group * 2].detach();
  resources.backLineStroke.setStrokeWidth((0.8 + 0.5 * groupEnergy) * pixel);
  resources.backLineStroke.setAlphaf(limit(0.7 * brightness, 0.85));
  canvas.drawPath(backArcs, resources.backLineStroke);
  resources.backDashStroke.setStrokeWidth((1.1 + 0.7 * groupEnergy) * pixel);
  resources.backDashStroke.setAlphaf(limit(0.75 * brightness, 0.85));
  canvas.drawPath(backDashes, resources.backDashStroke);
  // front hemisphere: thicker, glow ~2x the stroke width
  const arcs = builders.shellArcs[group * 2 + 1].detach();
  const dashes = builders.shellDashes[group * 2 + 1].detach();
  const dashWidth = (2.7 + 1.4 * groupEnergy) * pixel;
  const lineWidth = (1.3 + 0.9 * groupEnergy) * pixel;
  resources.frontGlowStroke.setAlphaf(clamp01((0.13 + 0.2 * groupEnergy) * state.glowGain * pulse));
  resources.frontGlowStroke.setStrokeWidth(lineWidth * 2.6);
  canvas.drawPath(arcs, resources.frontGlowStroke);
  resources.frontGlowStroke.setAlphaf(clamp01((0.06 + 0.07 * groupEnergy) * state.glowGain * pulse));
  resources.frontGlowStroke.setStrokeWidth(dashWidth * 2);
  canvas.drawPath(dashes, resources.frontGlowStroke);
  resources.frontLineStroke.setStrokeWidth(lineWidth);
  resources.frontLineStroke.setAlphaf(limit(0.8 * brightness, 0.95));
  canvas.drawPath(arcs, resources.frontLineStroke);
  resources.frontDashStroke.setStrokeWidth(dashWidth);
  resources.frontDashStroke.setAlphaf(limit(0.82 * brightness, 0.95));
  canvas.drawPath(dashes, resources.frontDashStroke);
  // band-revealed pale-gold filaments on the fine front arcs
  resources.paleGoldStroke.setStrokeWidth((0.6 + 0.5 * groupEnergy) * pixel);
  resources.paleGoldStroke.setAlphaf(limit(0.12 + groupEnergy * 1.3 + state.energy * 0.1, 0.95));
  canvas.drawPath(arcs, resources.paleGoldStroke);
}

/** The inner counter-rotating frame, driven by the bass. */
function drawInnerShell(canvas: HologramCanvas, resources: Resources, state: FrameState) {
  'worklet';
  const bassEnergy = state.bassEnergy;
  const innerArcs = resources.pathBuilders.innerArcs.detach();
  const innerDashes = resources.pathBuilders.innerDashes.detach();
  const dashWidth = (1.8 + 0.9 * bassEnergy) * state.pixel;
  resources.glowStroke.setStrokeWidth(dashWidth * 2);
  resources.glowStroke.setAlphaf(clamp01((0.05 + 0.05 * bassEnergy) * state.glowGain));
  canvas.drawPath(innerDashes, resources.glowStroke);
  resources.lineStroke.setStrokeWidth((0.9 + 0.5 * bassEnergy) * state.pixel);
  resources.lineStroke.setAlphaf(limit(0.65 + 0.3 * bassEnergy, 0.95));
  canvas.drawPath(innerArcs, resources.lineStroke);
  resources.dashStroke.setStrokeWidth(dashWidth);
  resources.dashStroke.setAlphaf(limit(0.75 + 0.25 * bassEnergy, 1));
  canvas.drawPath(innerDashes, resources.dashStroke);
}

/** Sphere fragments: nested shells of broken arcs, dashes and ticks on a tilted spinning axis. */
function drawSphereShells(
  canvas: HologramCanvas,
  resources: Resources,
  scene: Scene,
  state: FrameState,
  scratch: Scratch,
) {
  'worklet';
  appendSphereFragments(resources.pathBuilders, scene.fragments, state, scratch.endpoints);
  drawShellGroup(canvas, resources, state, 0, state.lowMidRimEnergy);
  drawShellGroup(canvas, resources, state, 1, state.highRimEnergy);
  drawInnerShell(canvas, resources, state);
}

/** Prebuilt rim rings: a dense broken band hugging the limb, animated only with canvas transforms. */
function drawRimRings(canvas: HologramCanvas, resources: Resources, rimRings: Scene['rimRings'], state: FrameState) {
  'worklet';
  const time = state.time;
  for (let i = 0; i < rimRings.length; i++) {
    const ring = rimRings[i];
    const zoneEnergy = state.zoneEnergy[ring.zone];
    const ringRadius = ring.radius * (1 + 0.03 * zoneEnergy);
    canvas.save();
    canvas.rotate(ring.tilt + 8 * Math.sin(time * 0.05 + i), 0, 0);
    canvas.scale(ringRadius, ringRadius * ring.squash);
    canvas.rotate(time * ring.speed, 0, 0);
    const inverseScale = state.pixel / ringRadius;
    const path = resources.rimPaths[i];
    const width = (1.3 + 1.8 * zoneEnergy) * inverseScale * ring.width;
    resources.glowStroke.setStrokeWidth(width * 2.5);
    resources.glowStroke.setAlphaf(clamp01((0.08 + 0.14 * zoneEnergy) * state.glowGain));
    canvas.drawPath(path, resources.glowStroke);
    resources.dashStroke.setStrokeWidth(width);
    resources.dashStroke.setAlphaf(limit(0.5 + 0.45 * zoneEnergy, 0.95));
    canvas.drawPath(path, resources.dashStroke);
    canvas.restore();
  }
}

function drawSpeckPaths(
  canvas: HologramCanvas,
  resources: Resources,
  state: FrameState,
  sparkCount: number,
  hotSparkCount: number,
) {
  'worklet';
  const builders = resources.pathBuilders;
  const pixel = state.pixel;
  const outerEnergy = state.highRimEnergy;
  const highEnergy = state.highEnergy;
  resources.backSpeckStroke.setStrokeWidth((1 + 0.4 * outerEnergy) * pixel);
  resources.backSpeckStroke.setAlphaf(limit(0.7 + 0.25 * outerEnergy, 0.95));
  canvas.drawPath(builders.speckBack.detach(), resources.backSpeckStroke);
  resources.frontSpeckStroke.setStrokeWidth((2.5 + 1.1 * outerEnergy) * pixel);
  resources.frontSpeckStroke.setAlphaf(limit(0.85 + 0.15 * outerEnergy, 1));
  canvas.drawPath(builders.speckFront.detach(), resources.frontSpeckStroke);
  const sparkPath = builders.sparks.detach();
  const hotSparkPath = builders.hotSparks.detach();
  if (sparkCount > 0) {
    resources.sparkStroke.setStrokeWidth((2.4 + 1 * highEnergy) * pixel);
    resources.sparkStroke.setAlphaf(limit(0.6 + 0.25 * highEnergy, 0.85));
    canvas.drawPath(sparkPath, resources.sparkStroke);
  }
  if (hotSparkCount > 0) {
    resources.paleGoldStroke.setStrokeWidth((2.8 + 1.2 * highEnergy) * pixel);
    resources.paleGoldStroke.setAlphaf(limit(0.5 + 0.2 * highEnergy, 0.7));
    canvas.drawPath(hotSparkPath, resources.paleGoldStroke);
  }
}

/** Specks: zero-length square-cap segments in 4 paths (back, front, sparks, hot sparks). */
function drawSpecks(canvas: HologramCanvas, resources: Resources, specks: number[], state: FrameState) {
  'worklet';
  const builders = resources.pathBuilders;
  const time = state.time;
  const matrix = state.outerRotation;
  const xFromX = matrix[0];
  const xFromY = matrix[1];
  const xFromZ = matrix[2];
  const yFromX = matrix[3];
  const yFromY = matrix[4];
  const yFromZ = matrix[5];
  const depthFromX = matrix[6];
  const depthFromY = matrix[7];
  const depthFromZ = matrix[8];
  let sparkCount = 0;
  let hotSparkCount = 0;
  for (let offset = 0; offset < specks.length; offset += 10) {
    const zoneEnergy = state.zoneEnergy[specks[offset + 1]];
    const scale = specks[offset] * (1 + (0.04 + 0.1 * specks[offset + 4]) * zoneEnergy);
    const drift = 0.08 * Math.sin(time * 0.5 + specks[offset + 2]);
    const x = (specks[offset + 5] + specks[offset + 8] * drift) * scale;
    const y = specks[offset + 6] * scale;
    const z = (specks[offset + 7] + specks[offset + 9] * drift) * scale;
    const depth = depthFromX * x + depthFromY * y + depthFromZ * z;
    const perspective = 3.6 / (3.6 - depth);
    const screenX = (xFromX * x + xFromY * y + xFromZ * z) * perspective;
    const screenY = -(yFromX * x + yFromY * y + yFromZ * z) * perspective;
    // each speck goes to exactly one bucket: 2 builder calls per speck
    const twinkle = Math.sin(time * specks[offset + 3] + specks[offset + 2]) + 0.5 * zoneEnergy;
    let builder = depth < 0 ? builders.speckBack : builders.speckFront;
    if (twinkle > 0.93 && depth > 0) {
      builder = builders.hotSparks;
      hotSparkCount++;
    } else if (twinkle > 0.72 && depth > -0.4) {
      builder = builders.sparks;
      sparkCount++;
    }
    builder.moveTo(screenX, screenY);
    builder.lineTo(screenX, screenY);
  }
  drawSpeckPaths(canvas, resources, state, sparkCount, hotSparkCount);
}

/** Appends one orbital ring's dashes as conics, each to the back or front builder by the depth of its middle. */
function appendOrbitalRingDashes(
  back: PathBuilder,
  front: PathBuilder,
  scratch: Scratch,
  dashes: number[],
  radius: number,
  extent: number,
) {
  'worklet';
  const matrix = scratch.rotation;
  const pointA = scratch.pointA;
  const pointB = scratch.pointB;
  for (let k = 0; k < dashes.length; k += 2) {
    const startAngle = dashes[k];
    const length = dashes[k + 1] * extent;
    const halfLength = length * 0.5;
    const weight = Math.cos(halfLength);
    projectPoint(
      pointB,
      matrix,
      (Math.cos(startAngle + halfLength) * radius) / weight,
      0,
      (Math.sin(startAngle + halfLength) * radius) / weight,
    );
    const builder = pointB[2] < 0 ? back : front;
    projectPoint(pointA, matrix, Math.cos(startAngle) * radius, 0, Math.sin(startAngle) * radius);
    builder.moveTo(pointA[0], pointA[1]);
    const controlX = pointB[0];
    const controlY = pointB[1];
    projectPoint(pointA, matrix, Math.cos(startAngle + length) * radius, 0, Math.sin(startAngle + length) * radius);
    builder.conicTo(controlX, controlY, pointA[0], pointA[1], weight);
  }
}

/** Tilted dashed rings on the sphere; their dashes lengthen with their zone. */
function drawOrbitalRings(
  canvas: HologramCanvas,
  resources: Resources,
  orbitalRings: Scene['orbitalRings'],
  state: FrameState,
  scratch: Scratch,
) {
  'worklet';
  const builders = resources.pathBuilders;
  let ringEnergy = 0;
  for (let i = 0; i < orbitalRings.length; i++) {
    const ring = orbitalRings[i];
    const zoneEnergy = state.zoneEnergy[ring.zone];
    ringEnergy += zoneEnergy / orbitalRings.length;
    writeRotation(scratch.rotation, state.time * ring.speed, ring.tiltX + state.pitch, ring.tiltZ + state.roll);
    const radius = ring.radius * (1 + 0.03 * zoneEnergy);
    const extent = 0.5 + 0.5 * clamp01(0.35 + zoneEnergy * 1.2);
    const front = ring.radius > 0.99 ? builders.ringFrontOuter : builders.ringFrontInner;
    appendOrbitalRingDashes(builders.ringBack, front, scratch, ring.dashes, radius, extent);
  }
  const backPath = builders.ringBack.detach();
  const frontOuterPath = builders.ringFrontOuter.detach();
  const frontInnerPath = builders.ringFrontInner.detach();
  const ringWidth = (1.1 + 0.8 * ringEnergy) * state.pixel;
  resources.glowStroke.setStrokeWidth(ringWidth * 2.6);
  resources.glowStroke.setAlphaf(clamp01((0.05 + 0.08 * ringEnergy) * state.glowGain));
  canvas.drawPath(frontOuterPath, resources.glowStroke);
  resources.lineStroke.setStrokeWidth(ringWidth * 0.8);
  resources.lineStroke.setAlphaf(limit(0.22 + 0.15 * ringEnergy, 0.6));
  canvas.drawPath(backPath, resources.lineStroke);
  resources.lineStroke.setStrokeWidth(ringWidth);
  resources.lineStroke.setAlphaf(limit(0.3 + 0.25 * ringEnergy, 0.6));
  canvas.drawPath(frontInnerPath, resources.lineStroke);
  resources.lineStroke.setAlphaf(limit(0.55 + 0.3 * ringEnergy, 0.85));
  canvas.drawPath(frontOuterPath, resources.lineStroke);
}

/** Crown spikes; returns their mean band energy. */
function appendCrownSpikes(crown: PathBuilder, tips: PathBuilder, spikes: number[], state: FrameState, spin: number) {
  'worklet';
  const TAU = Math.PI * 2;
  let crownEnergy = 0;
  for (let offset = 0; offset < spikes.length; offset += 4) {
    const baseAngle = spikes[offset];
    // lows at the top, highs at the bottom, mirrored
    const bandEnergy = mirroredBand(state.bands, baseAngle / TAU, spikes[offset + 3]) * state.speakingScale;
    const tipDrive = bandEnergy * Math.sqrt(bandEnergy); // band^1.5
    crownEnergy += bandEnergy;
    const length = spikes[offset + 1] * (0.06 + 0.012 * Math.sin(state.time * 0.7 + offset));
    const growth = 0.1 * tipDrive;
    const angle = baseAngle - Math.PI / 2 + spin;
    const cosAngle = Math.cos(angle);
    const sinAngle = Math.sin(angle);
    const startRadius = spikes[offset + 2];
    const endRadius = startRadius + length;
    appendRadialSegment(crown, cosAngle, sinAngle, 0, startRadius, startRadius + length * 0.6);
    appendRadialSegment(crown, cosAngle, sinAngle, 0, startRadius + length * 0.72, endRadius);
    if (growth > 0.003) {
      appendRadialSegment(tips, cosAngle, sinAngle, 0, endRadius + 0.006, endRadius + 0.006 + growth);
    }
  }
  return crownEnergy / (spikes.length / 4);
}

/** A rim comb: a tangential bar with teeth pointing outward. */
function appendComb(
  crown: PathBuilder,
  tips: PathBuilder,
  cosAngle: number,
  sinAngle: number,
  baseRadius: number,
  toothCount: number,
  toothGap: number,
  teeth: number[],
  firstTooth: number,
  wobble: number,
  tipDrive: number,
) {
  'worklet';
  const halfSpan = ((toothCount - 1) / 2) * toothGap;
  crown.moveTo(cosAngle * baseRadius + sinAngle * halfSpan, sinAngle * baseRadius - cosAngle * halfSpan);
  crown.lineTo(cosAngle * baseRadius - sinAngle * halfSpan, sinAngle * baseRadius + cosAngle * halfSpan);
  for (let k = 0; k < toothCount; k++) {
    const tangentialOffset = k * toothGap - halfSpan;
    const toothEnd = baseRadius + teeth[firstTooth + k] * wobble;
    appendRadialSegment(crown, cosAngle, sinAngle, tangentialOffset, baseRadius, toothEnd);
    const growth = 0.08 * tipDrive * (0.6 + 0.4 * ((k * 0.618) % 1));
    if (growth > 0.003) appendRadialSegment(tips, cosAngle, sinAngle, tangentialOffset, toothEnd, toothEnd + growth);
  }
}

/** A rim circuit trace: out to the bend radius, a tangential jog, then on to the end radius. */
function appendCircuitTrace(
  crown: PathBuilder,
  tips: PathBuilder,
  cosAngle: number,
  sinAngle: number,
  startRadius: number,
  jog: number,
  bendRadius: number,
  endRadius: number,
  tipDrive: number,
) {
  'worklet';
  crown.moveTo(cosAngle * startRadius, sinAngle * startRadius);
  crown.lineTo(cosAngle * bendRadius, sinAngle * bendRadius);
  const jogX = cosAngle * (bendRadius + 0.02) - sinAngle * jog;
  const jogY = sinAngle * (bendRadius + 0.02) + cosAngle * jog;
  crown.lineTo(jogX, jogY);
  crown.lineTo(jogX + cosAngle * (endRadius - bendRadius - 0.02), jogY + sinAngle * (endRadius - bendRadius - 0.02));
  const growth = 0.07 * tipDrive;
  if (growth > 0.003) {
    tips.moveTo(jogX + cosAngle * (endRadius - bendRadius - 0.02), jogY + sinAngle * (endRadius - bendRadius - 0.02));
    tips.lineTo(
      jogX + cosAngle * (endRadius - bendRadius - 0.02 + growth),
      jogY + sinAngle * (endRadius - bendRadius - 0.02 + growth),
    );
  }
}

function appendRimCombs(crown: PathBuilder, tips: PathBuilder, scene: Scene, state: FrameState, spin: number) {
  'worklet';
  const combs = scene.rimCombs;
  for (let offset = 0; offset < combs.length; offset += 6) {
    const angle = combs[offset] + spin;
    const bandEnergy = bandForScreenAngle(state.bands, combs[offset]) * state.speakingScale;
    const tipDrive = bandEnergy * Math.sqrt(bandEnergy); // band^1.5
    const cosAngle = Math.cos(angle);
    const sinAngle = Math.sin(angle);
    const baseRadius = combs[offset + 1];
    if (combs[offset + 2] < 0.5) {
      const wobble = 1 + 0.06 * Math.sin(state.time * 0.8 + offset);
      appendComb(
        crown,
        tips,
        cosAngle,
        sinAngle,
        baseRadius,
        combs[offset + 3],
        combs[offset + 4],
        scene.combTeeth,
        combs[offset + 5],
        wobble,
        tipDrive,
      );
    } else {
      appendCircuitTrace(
        crown,
        tips,
        cosAngle,
        sinAngle,
        baseRadius,
        combs[offset + 3],
        combs[offset + 4],
        combs[offset + 5],
        tipDrive,
      );
    }
  }
}

/** Ladder strut: two rails, rungs, closed end. */
function appendLadderStrut(
  crown: PathBuilder,
  tips: PathBuilder,
  cosAngle: number,
  sinAngle: number,
  startRadius: number,
  endRadius: number,
  width: number,
  rungCount: number,
  growth: number,
) {
  'worklet';
  const halfWidth = width * 0.5;
  appendRadialSegment(crown, cosAngle, sinAngle, -halfWidth, startRadius, endRadius);
  appendRadialSegment(crown, cosAngle, sinAngle, halfWidth, startRadius + 0.04, endRadius);
  for (let k = 1; k <= rungCount; k++) {
    const rungRadius = startRadius + 0.04 + ((endRadius - startRadius - 0.04) * k) / rungCount;
    crown.moveTo(cosAngle * rungRadius + sinAngle * halfWidth, sinAngle * rungRadius - cosAngle * halfWidth);
    crown.lineTo(cosAngle * rungRadius - sinAngle * halfWidth, sinAngle * rungRadius + cosAngle * halfWidth);
  }
  if (growth > 0.003) {
    appendRadialSegment(tips, cosAngle, sinAngle, -halfWidth, endRadius, endRadius + growth);
    appendRadialSegment(tips, cosAngle, sinAngle, halfWidth, endRadius, endRadius + growth * 0.6);
  }
}

/** Circuit strut: a trace with a jog and a square pad pushed out by the tip growth. */
function appendCircuitStrut(
  crown: PathBuilder,
  tips: PathBuilder,
  cosAngle: number,
  sinAngle: number,
  startRadius: number,
  endRadius: number,
  jog: number,
  seed: number,
  growth: number,
) {
  'worklet';
  const bendRadius = startRadius + (endRadius - startRadius) * (0.35 + 0.3 * seed);
  crown.moveTo(cosAngle * startRadius, sinAngle * startRadius);
  crown.lineTo(cosAngle * bendRadius, sinAngle * bendRadius);
  crown.lineTo(cosAngle * (bendRadius + 0.03) - sinAngle * jog, sinAngle * (bendRadius + 0.03) + cosAngle * jog);
  crown.lineTo(cosAngle * endRadius - sinAngle * jog, sinAngle * endRadius + cosAngle * jog);
  const padRadius = endRadius + growth;
  const padHalfSize = 0.012;
  if (growth > 0.003) appendRadialSegment(tips, cosAngle, sinAngle, jog, endRadius, padRadius);
  const nearRadius = padRadius - padHalfSize;
  const farRadius = padRadius + padHalfSize;
  crown.moveTo(
    cosAngle * nearRadius - sinAngle * (jog - padHalfSize),
    sinAngle * nearRadius + cosAngle * (jog - padHalfSize),
  );
  crown.lineTo(
    cosAngle * farRadius - sinAngle * (jog - padHalfSize),
    sinAngle * farRadius + cosAngle * (jog - padHalfSize),
  );
  crown.lineTo(
    cosAngle * farRadius - sinAngle * (jog + padHalfSize),
    sinAngle * farRadius + cosAngle * (jog + padHalfSize),
  );
  crown.lineTo(
    cosAngle * nearRadius - sinAngle * (jog + padHalfSize),
    sinAngle * nearRadius + cosAngle * (jog + padHalfSize),
  );
  crown.close();
}

/** Hanging comb strut: a tangential bar with long uneven teeth outward. */
function appendHangingCombStrut(
  crown: PathBuilder,
  tips: PathBuilder,
  cosAngle: number,
  sinAngle: number,
  startRadius: number,
  endRadius: number,
  width: number,
  toothCount: number,
  seed: number,
  growth: number,
) {
  'worklet';
  const halfWidth = width * 0.5;
  const barRadius = startRadius + 0.06;
  crown.moveTo(cosAngle * barRadius + sinAngle * halfWidth, sinAngle * barRadius - cosAngle * halfWidth);
  crown.lineTo(cosAngle * barRadius - sinAngle * halfWidth, sinAngle * barRadius + cosAngle * halfWidth);
  appendRadialSegment(crown, cosAngle, sinAngle, 0, startRadius, barRadius);
  for (let k = 0; k <= toothCount + 2; k++) {
    const tangentialOffset = -halfWidth + (width * k) / (toothCount + 2);
    const lengthFraction = 0.35 + 0.65 * ((seed + k * 0.618) % 1);
    const toothEnd = barRadius + (endRadius - barRadius) * lengthFraction;
    appendRadialSegment(crown, cosAngle, sinAngle, tangentialOffset, barRadius, toothEnd);
    if (growth > 0.003) {
      appendRadialSegment(tips, cosAngle, sinAngle, tangentialOffset, toothEnd, toothEnd + growth * lengthFraction);
    }
  }
}

function appendStruts(crown: PathBuilder, tips: PathBuilder, struts: number[], state: FrameState, spin: number) {
  'worklet';
  for (let offset = 0; offset < struts.length; offset += 7) {
    const angle = struts[offset] + spin;
    const bandEnergy = bandForScreenAngle(state.bands, struts[offset]) * state.speakingScale;
    const tipDrive = bandEnergy * Math.sqrt(bandEnergy); // band^1.5
    const cosAngle = Math.cos(angle);
    const sinAngle = Math.sin(angle);
    const type = struts[offset + 1];
    const startRadius = struts[offset + 2];
    const endRadius = struts[offset + 3] + 0.01 * Math.sin(state.time * 0.6 + offset);
    const widthOrJog = struts[offset + 4];
    const count = struts[offset + 5];
    const seed = struts[offset + 6];
    const growth = 0.07 * tipDrive;
    if (type === 0) {
      appendLadderStrut(crown, tips, cosAngle, sinAngle, startRadius, endRadius, widthOrJog, count, growth);
    } else if (type === 1) {
      appendCircuitStrut(crown, tips, cosAngle, sinAngle, startRadius, endRadius, widthOrJog, seed, growth);
    } else {
      appendHangingCombStrut(crown, tips, cosAngle, sinAngle, startRadius, endRadius, widthOrJog, count, seed, growth);
    }
  }
}

/** The readable spectrum: crown spikes, rim combs and protruding struts, each following the band at its screen angle. */
function drawSpectrum(canvas: HologramCanvas, resources: Resources, scene: Scene, state: FrameState) {
  'worklet';
  const builders = resources.pathBuilders;
  const crown = builders.crown;
  const tips = builders.crownTips;
  const spin = 0.22 * Math.sin(state.time * 0.05) + 0.08 * Math.sin(state.time * 0.13);
  const crownEnergy = appendCrownSpikes(crown, tips, scene.crownSpikes, state, spin);
  appendRimCombs(crown, tips, scene, state, spin);
  appendStruts(crown, tips, scene.struts, state, spin);
  const crownPath = crown.detach();
  const tipPath = tips.detach();
  resources.glowStroke.setStrokeWidth(3.4 * state.pixel);
  resources.glowStroke.setAlphaf(clamp01((0.06 + 0.12 * crownEnergy) * state.glowGain));
  canvas.drawPath(crownPath, resources.glowStroke);
  resources.dashStroke.setStrokeWidth((1.3 + 0.5 * crownEnergy) * state.pixel);
  resources.dashStroke.setAlphaf(limit(0.7 + 0.25 * crownEnergy, 0.95));
  canvas.drawPath(crownPath, resources.dashStroke);
  resources.glowStroke.setStrokeWidth(4.5 * state.pixel);
  resources.glowStroke.setAlphaf(0.1);
  canvas.drawPath(tipPath, resources.glowStroke);
  resources.paleGoldStroke.setStrokeWidth(1.5 * state.pixel);
  resources.paleGoldStroke.setAlphaf(0.95);
  canvas.drawPath(tipPath, resources.paleGoldStroke);
}

/** The C's geometry: three width tiers of 3D arcs, open on the right, the top curling into the core. */
function appendCrescent(tiers: PathBuilder[], state: FrameState, scratch: Scratch) {
  'worklet';
  const time = state.time;
  const bassEnergy = state.bassEnergy;
  const energy = state.energy;
  const matrix = scratch.rotation;
  const pointA = scratch.pointA;
  const pointB = scratch.pointB;
  const thin = tiers[0];
  const medium = tiers[1];
  const wide = tiers[2];
  const yaw = 0.32 + 0.14 * Math.sin(time * 0.13);
  writeRotation(matrix, yaw, Math.PI / 2 - 0.2 + 0.08 * Math.sin(time * 0.17), 0.08 * Math.sin(time * 0.1));
  // ring angle a maps to screen angle ≈ a − yaw (y down); centre the C a little below 9 o'clock
  const centreAngle = Math.PI - 0.12 + yaw + 0.12 * Math.sin(time * 0.07) + 0.06 * Math.sin(time * 0.19 + 1);
  const sweep = 3.5 + 0.25 * bassEnergy + 0.06 * energy;
  const radius = 0.74 * (1 + 0.04 * bassEnergy + 0.01 * energy);
  const startAngle = centreAngle - sweep / 2;
  const offsetX = 0.02;
  const offsetY = 0.01;
  // tier 1 (thin, full length): the ribbon's strands, ragged ends
  appendProjectedArc(
    thin,
    matrix,
    radius * 0.97,
    radius * 0.97,
    startAngle + 0.1,
    sweep - 0.25,
    offsetX,
    offsetY,
    pointA,
    pointB,
  );
  appendProjectedArc(thin, matrix, radius, radius, startAngle, sweep, offsetX, offsetY, pointA, pointB);
  const strandRadius = radius * (1.025 + 0.006 * Math.sin(time * 0.5 + 2));
  appendProjectedArc(
    thin,
    matrix,
    strandRadius,
    radius * 1.025,
    startAngle + 0.22,
    sweep - 0.3,
    offsetX,
    offsetY,
    pointA,
    pointB,
  );
  const outerStrandRadius = radius * (1.05 + 0.008 * Math.sin(time * 0.6));
  appendProjectedArc(
    thin,
    matrix,
    outerStrandRadius,
    radius * 1.05,
    startAngle + 0.5,
    sweep - 0.95,
    offsetX,
    offsetY,
    pointA,
    pointB,
  );
  appendProjectedArc(
    thin,
    matrix,
    radius * 0.94,
    radius * 0.94,
    startAngle + 0.7,
    sweep * 0.5,
    offsetX,
    offsetY,
    pointA,
    pointB,
  );
  // the curl: the top end keeps turning and spirals all the way in to the core
  const curlSweep = 2.5 + 0.2 * state.midEnergy;
  appendProjectedArc(thin, matrix, radius, 0.3, startAngle + sweep, curlSweep, offsetX, offsetY, pointA, pointB);
  appendProjectedArc(
    thin,
    matrix,
    radius * 0.97,
    0.36,
    startAngle + sweep - 0.25,
    2.2,
    offsetX,
    offsetY,
    pointA,
    pointB,
  );
  // tier 2 (medium): middle 78% plus the start of the curl
  const mediumSweep = sweep * 0.78;
  const mediumStart = centreAngle - mediumSweep / 2;
  appendProjectedArc(medium, matrix, radius, radius, mediumStart, mediumSweep, offsetX, offsetY, pointA, pointB);
  const secondStart = centreAngle - mediumSweep * 0.42;
  appendProjectedArc(
    medium,
    matrix,
    radius * 1.025,
    radius * 1.025,
    secondStart,
    mediumSweep * 0.84,
    offsetX,
    offsetY,
    pointA,
    pointB,
  );
  const curlStart = centreAngle + mediumSweep / 2 + (sweep - mediumSweep) / 2;
  appendProjectedArc(medium, matrix, radius, radius * 0.62, curlStart, 1.2, offsetX, offsetY, pointA, pointB);
  // tier 3 (widest, brightest): middle 50%
  const wideSweep = sweep * 0.5;
  const wideStart = centreAngle - wideSweep / 2;
  appendProjectedArc(
    wide,
    matrix,
    radius * 1.005,
    radius * 1.005,
    wideStart,
    wideSweep,
    offsetX,
    offsetY,
    pointA,
    pointB,
  );
  // inner arc hugging the core on the upper right
  writeRotation(matrix, -0.3 + 0.1 * Math.sin(time * 0.2), Math.PI / 2 - 0.35, 0);
  const hugRadius = 0.33 * (1 + 0.08 * bassEnergy);
  const hugStart = -1.4 + 0.3 * Math.sin(time * 0.15);
  appendProjectedArc(
    thin,
    matrix,
    hugRadius,
    hugRadius,
    hugStart,
    1.6 + 0.5 * state.midEnergy,
    0.08,
    0.0,
    pointA,
    pointB,
  );
}

/** The "C": a big soft tapered ribbon, open on the right, its top curling into the core. Tapering comes from width tiers. */
function drawCrescent(canvas: HologramCanvas, resources: Resources, state: FrameState, scratch: Scratch) {
  'worklet';
  const tiers = resources.pathBuilders.crescentTiers;
  appendCrescent(tiers, state, scratch);
  const bassEnergy = state.bassEnergy;
  const pixel = state.pixel;
  const thinPath = tiers[0].detach();
  const mediumPath = tiers[1].detach();
  const widePath = tiers[2].detach();
  const widthScale = 1 + 0.8 * bassEnergy + 0.15 * state.energy;
  const brightness = 0.8 + 0.8 * bassEnergy;
  resources.glowStroke.setStrokeWidth(40 * widthScale * pixel);
  resources.glowStroke.setAlphaf(clamp01(0.12 * state.glowGain * brightness));
  canvas.drawPath(widePath, resources.glowStroke);
  resources.glowStroke.setStrokeWidth(20 * widthScale * pixel);
  resources.glowStroke.setAlphaf(clamp01(0.12 * state.glowGain * brightness));
  canvas.drawPath(mediumPath, resources.glowStroke);
  resources.glowStroke.setStrokeWidth(6 * widthScale * pixel);
  resources.glowStroke.setAlphaf(clamp01(0.12 * state.glowGain * brightness));
  canvas.drawPath(thinPath, resources.glowStroke);
  resources.lineStroke.setStrokeWidth((1 + 0.5 * bassEnergy) * pixel);
  resources.lineStroke.setAlphaf(limit(0.8 * brightness, 0.95));
  canvas.drawPath(thinPath, resources.lineStroke);
  resources.lineStroke.setStrokeWidth((1.7 + 0.6 * bassEnergy) * pixel);
  resources.lineStroke.setAlphaf(limit(0.6 * brightness, 0.85));
  canvas.drawPath(mediumPath, resources.lineStroke);
  resources.lineStroke.setStrokeWidth((2.5 + 0.8 * bassEnergy) * pixel);
  resources.lineStroke.setAlphaf(limit(0.6 * brightness, 0.85));
  canvas.drawPath(widePath, resources.lineStroke);
  resources.paleGoldStroke.setStrokeWidth(1 * pixel);
  resources.paleGoldStroke.setAlphaf(limit(0.35 * brightness, 0.6));
  canvas.drawPath(widePath, resources.paleGoldStroke);
}

/** Warm core bloom, and its comet tail: the same bloom squashed and pushed right. */
function drawCoreBloom(canvas: HologramCanvas, resources: Resources, state: FrameState, coreX: number, coreY: number) {
  'worklet';
  const bassEnergy = state.bassEnergy;
  const midEnergy = state.midEnergy;
  const coreRadius = (0.42 + 0.05 * state.energy + 0.1 * bassEnergy) * state.heartbeat;
  canvas.save();
  canvas.translate(coreX + 0.02, coreY);
  canvas.scale(coreRadius * 1.15, coreRadius * 0.95);
  resources.coreBloomFill.setAlphaf(0.7 + 0.3 * bassEnergy);
  canvas.drawCircle(0, 0, 1, resources.coreBloomFill);
  canvas.restore();
  // comet tail: the same bloom squashed and pushed right
  canvas.save();
  canvas.translate(coreX + 0.16 + 0.03 * midEnergy, coreY + 0.005);
  canvas.scale(coreRadius * (0.9 + 0.3 * midEnergy), coreRadius * 0.16);
  resources.coreBloomFill.setAlphaf(0.3 + 0.15 * midEnergy);
  canvas.drawCircle(0, 0, 1, resources.coreBloomFill);
  canvas.restore();
}

/** Fading horizontal data streaks from the core: bright near the core, then fading and faint tiers. */
function drawDataStreaks(
  canvas: HologramCanvas,
  resources: Resources,
  streaks: number[],
  state: FrameState,
  coreX: number,
  coreY: number,
) {
  'worklet';
  const time = state.time;
  const midEnergy = state.midEnergy;
  const tiers = resources.pathBuilders.streakTiers;
  const bright = tiers[0];
  const fading = tiers[1];
  const faint = tiers[2];
  for (let offset = 0; offset < streaks.length; offset += 5) {
    const y = coreY + streaks[offset] * (1 + 0.4 * midEnergy);
    const speed = streaks[offset + 4];
    const phase = streaks[offset + 3];
    const startX = coreX + streaks[offset + 1] + 0.05 * Math.sin(time * speed + phase);
    const length = streaks[offset + 2] * (0.8 + 0.2 * Math.sin(time * speed * 1.3 + phase) + 0.35 * midEnergy);
    if (length < 0) {
      bright.moveTo(startX, y);
      bright.lineTo(startX + length, y);
    } else {
      bright.moveTo(startX, y);
      bright.lineTo(startX + length * 0.45, y);
      fading.moveTo(startX + length * 0.45, y);
      fading.lineTo(startX + length * 0.75, y);
      faint.moveTo(startX + length * 0.75, y);
      faint.lineTo(startX + length, y);
    }
  }
  const brightPath = bright.detach();
  const fadingPath = fading.detach();
  const faintPath = faint.detach();
  resources.glowStroke.setStrokeWidth((5 + 4 * midEnergy) * state.pixel);
  resources.glowStroke.setAlphaf(clamp01((0.07 + 0.14 * midEnergy) * state.glowGain));
  canvas.drawPath(brightPath, resources.glowStroke);
  resources.glowStroke.setAlphaf(clamp01((0.035 + 0.05 * midEnergy) * state.glowGain));
  canvas.drawPath(fadingPath, resources.glowStroke);
  resources.lineStroke.setStrokeWidth((1.2 + 0.7 * midEnergy) * state.pixel);
  resources.lineStroke.setAlphaf(limit(0.65 + 0.2 * midEnergy, 0.9));
  canvas.drawPath(brightPath, resources.lineStroke);
  resources.lineStroke.setAlphaf(limit(0.36 + 0.15 * midEnergy, 0.6));
  canvas.drawPath(fadingPath, resources.lineStroke);
  resources.lineStroke.setAlphaf(limit(0.15 + 0.12 * midEnergy, 0.4));
  canvas.drawPath(faintPath, resources.lineStroke);
}

/** The gold knotted gyroscope: small tilted loops around the core, swelling with the bass. */
function drawKnot(
  canvas: HologramCanvas,
  resources: Resources,
  knotLoops: number[],
  state: FrameState,
  scratch: Scratch,
  coreX: number,
  coreY: number,
) {
  'worklet';
  const time = state.time;
  const bassEnergy = state.bassEnergy;
  const pixel = state.pixel;
  const builder = resources.pathBuilders.knot;
  canvas.save();
  canvas.translate(coreX, coreY);
  canvas.scale(1.1, 0.9);
  canvas.translate(-coreX, -coreY);
  const knotScale = 1 + 0.3 * bassEnergy + 0.12 * state.energy;
  for (let offset = 0; offset < knotLoops.length; offset += 9) {
    const wobble = knotLoops[offset + 6];
    writeRotation(
      scratch.rotation,
      time * 0.3 + wobble,
      knotLoops[offset + 1] + 0.3 * Math.sin(time * 0.5 + wobble),
      knotLoops[offset + 2] + 0.25 * Math.sin(time * 0.37 + wobble),
    );
    const radius = knotLoops[offset] * knotScale;
    const startAngle = knotLoops[offset + 5] + time * knotLoops[offset + 3] + 0.6 * state.energy;
    const centreX = coreX + knotLoops[offset + 7] * knotScale + 0.02 * Math.sin(time * 0.8 + wobble);
    const centreY = coreY + knotLoops[offset + 8] * knotScale + 0.018 * Math.cos(time * 0.6 + wobble);
    const sweep = knotLoops[offset + 4];
    appendProjectedArc(
      builder,
      scratch.rotation,
      radius,
      radius,
      startAngle,
      sweep,
      centreX,
      centreY,
      scratch.pointA,
      scratch.pointB,
    );
  }
  const knotPath = builder.detach();
  const brightness = 0.85 + 0.6 * bassEnergy;
  resources.glowStroke.setStrokeWidth((12 + 8 * bassEnergy) * pixel);
  resources.glowStroke.setAlphaf(clamp01(0.085 * state.glowGain * brightness));
  canvas.drawPath(knotPath, resources.glowStroke);
  resources.lineStroke.setStrokeWidth((1.8 + 1 * bassEnergy) * pixel);
  resources.lineStroke.setAlphaf(limit(0.75 * brightness, 0.95));
  canvas.drawPath(knotPath, resources.lineStroke);
  resources.paleGoldStroke.setStrokeWidth((3.5 + 1.5 * bassEnergy) * pixel);
  resources.paleGoldStroke.setAlphaf(limit(0.18 * brightness, 0.4));
  canvas.drawPath(knotPath, resources.paleGoldStroke);
  resources.warmWhiteStroke.setStrokeWidth((0.9 + 0.4 * bassEnergy) * pixel);
  resources.warmWhiteStroke.setAlphaf(limit(0.35 * brightness, 0.45));
  canvas.drawPath(knotPath, resources.warmWhiteStroke);
  canvas.restore();
}

/** Draws one frame of the hologram into a size×size square. */
export function drawHologram(
  canvas: HologramCanvas,
  size: number,
  frame: HologramFrame,
  scene: Scene,
  resources: Resources,
) {
  'worklet';
  // start clean: a previous frame that threw mid-way must not leak half-built contours
  const allPathBuilders = resources.allPathBuilders;
  for (let i = 0; i < allPathBuilders.length; i++) allPathBuilders[i].reset();

  const state = analyseFrame(frame, size);
  const scratch: Scratch = {
    rotation: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    pointA: [0, 0, 0],
    pointB: [0, 0, 0],
    endpoints: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
  // the core's centre in unit space
  const coreX = 0.07;
  const coreY = 0.03;

  canvas.save();
  canvas.translate(size / 2, size / 2);
  canvas.scale(state.radius * 0.95, state.radius * 1.05); // the film's sphere is a taller oval
  drawInteriorWarmth(canvas, resources, state);
  drawRimWave(canvas, resources, state);
  drawGlassPanels(canvas, resources, scene, state, scratch);
  drawSphereShells(canvas, resources, scene, state, scratch);
  drawRimRings(canvas, resources, scene.rimRings, state);
  drawSpecks(canvas, resources, scene.specks, state);
  drawOrbitalRings(canvas, resources, scene.orbitalRings, state, scratch);
  drawSpectrum(canvas, resources, scene, state);
  drawCrescent(canvas, resources, state, scratch);
  drawCoreBloom(canvas, resources, state, coreX, coreY);
  drawDataStreaks(canvas, resources, scene.dataStreaks, state, coreX, coreY);
  drawKnot(canvas, resources, scene.knotLoops, state, scratch, coreX, coreY);
  canvas.restore();
}
