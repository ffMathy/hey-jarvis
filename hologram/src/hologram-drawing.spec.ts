import { beforeAll, describe, expect, it } from 'bun:test';
import { JsiSkApi } from '@shopify/react-native-skia/lib/module/skia/web';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web/LoadSkiaWeb';
import {
  BODY_TURN_SECONDS,
  bodyTurnRadians,
  createHologramResources,
  createHologramScene,
  drawHologram,
  type HologramFrame,
  MATERIALISE_SECONDS,
  PARTICLE_COUNT,
  ROLL_DEGREES_PER_SECOND,
  SHELL_DEGREES_PER_SECOND,
  SPHERE_FRACTION,
} from './hologram-drawing';
import { VOICE_BAND_COUNT } from './voice-levels';

/**
 * The hologram, drawn for real.
 *
 * React Native Skia's JavaScript API runs over CanvasKit here — the same drawing
 * calls the phone makes, rasterised on the CPU — so these tests look at actual
 * pixels rather than at which functions were called. They cannot say whether it
 * is beautiful; they can say it moves, that it answers Jarvis's voice the way the
 * film's sphere does — with activity, never with a brightness pulse — that it
 * spirals out of its core without a flash, that nothing pops in or out as its slow
 * script moves on, and that it stays inside its square.
 */

const SIZE = 256;
const SEED = 1337;
/** The sphere's radius in pixels, at rest. Taken from the drawing so the two cannot drift apart. */
const RADIUS = SIZE * SPHERE_FRACTION;

let Skia: ReturnType<typeof JsiSkApi>;

/** Where `LoadSkiaWeb` leaves CanvasKit once the WebAssembly has loaded. */
interface CanvasKitGlobal {
  CanvasKit: Parameters<typeof JsiSkApi>[0];
}

function hasCanvasKit(scope: object): scope is CanvasKitGlobal {
  return 'CanvasKit' in scope;
}

beforeAll(async () => {
  await LoadSkiaWeb();
  if (!hasCanvasKit(globalThis)) {
    throw new Error('CanvasKit did not load');
  }
  // The same API the app gets from the package root, built over CanvasKit.
  Skia = JsiSkApi(globalThis.CanvasKit);
});

/** A formed hologram with no voice at all. */
function silence(time: number): HologramFrame {
  return {
    time,
    level: 0,
    bands: new Array(VOICE_BAND_COUNT).fill(0),
    speaking: false,
    agitation: 0,
    burstAge: 10,
    burstStrength: 0,
    burstCount: 0,
    appearance: 1,
    thinking: 0,
    presence: 1,
    density: 1,
  };
}

/** A formed hologram while Jarvis talks: fully agitated, with the latest burst `burstAge` seconds ago. */
function speech(time: number, level: number, bands: number[], burstAge = 10, burstCount = 0): HologramFrame {
  return {
    time,
    level,
    bands,
    speaking: true,
    agitation: 1,
    burstAge,
    burstStrength: burstAge < 10 ? 1 : 0,
    burstCount,
    appearance: 1,
    thinking: 0,
    presence: 1,
    density: 1,
  };
}

/** A spectrum with energy in the lowest bands only, or the highest only. */
function spectrum(where: 'low' | 'high', energy: number): number[] {
  return Array.from({ length: VOICE_BAND_COUNT }, (_, band) => {
    const isLow = band < VOICE_BAND_COUNT / 3;
    const isHigh = band >= (VOICE_BAND_COUNT * 2) / 3;
    return (where === 'low' ? isLow : isHigh) ? energy : 0;
  });
}

type Hologram = {
  scene: ReturnType<typeof createHologramScene>;
  resources: ReturnType<typeof createHologramResources>;
};

/** A freshly built scene and resources, as a newly mounted canvas has. */
function mount(): Hologram {
  const scene = createHologramScene(SEED);
  return { scene, resources: createHologramResources(Skia, scene) };
}

/** Renders one frame and returns its RGBA pixels; with no hologram given, on a freshly mounted one. */
function render(frame: HologramFrame, hologram: Hologram = mount(), background = '#000000'): Uint8Array {
  const surface = Skia.Surface.MakeOffscreen(SIZE, SIZE) ?? Skia.Surface.Make(SIZE, SIZE);
  if (!surface) {
    throw new Error('Could not create a surface to draw on');
  }

  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color(background));
  drawHologram(canvas, SIZE, frame, hologram.scene, hologram.resources);
  surface.flush();

  const pixels = surface.makeImageSnapshot().readPixels();
  if (!(pixels instanceof Uint8Array)) {
    throw new Error('Could not read the pixels back');
  }
  return pixels;
}

function luminance(pixels: Uint8Array, index: number): number {
  return 0.2126 * (pixels[index] ?? 0) + 0.7152 * (pixels[index + 1] ?? 0) + 0.0722 * (pixels[index + 2] ?? 0);
}

/** Distance of a pixel's centre from the sphere's centre, in sphere radii. */
function radiusOf(x: number, y: number): number {
  return Math.hypot(x + 0.5 - SIZE / 2, y + 0.5 - SIZE / 2) / RADIUS;
}

/** Where the light sits up and down the square, 0 at the top and 1 at the bottom. */
function lightHeight(pixels: Uint8Array): number {
  let weighted = 0;
  let total = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const here = luminance(pixels, (y * SIZE + x) * 4);
      weighted += here * y;
      total += here;
    }
  }
  return total === 0 ? 0.5 : weighted / total / SIZE;
}

/** How far out the light sits, in sphere radii at rest: the luminance-weighted mean distance from the middle. */
function lightReach(pixels: Uint8Array): number {
  let weighted = 0;
  let total = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const here = luminance(pixels, (y * SIZE + x) * 4);
      weighted += here * radiusOf(x, y);
      total += here;
    }
  }
  return total === 0 ? 0 : weighted / total;
}

/** Mean luminance over the whole square, 0–255. */
function brightness(pixels: Uint8Array): number {
  let total = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    total += luminance(pixels, index);
  }
  return total / (pixels.length / 4);
}

/** Mean luminance inside 0.95 of the sphere's radius: the disc the film study measured. */
function discBrightness(pixels: Uint8Array): number {
  let total = 0;
  let count = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (radiusOf(x, y) >= 0.95) continue;
      total += luminance(pixels, (y * SIZE + x) * 4);
      count++;
    }
  }
  return total / count;
}

/** Mean absolute difference per channel between two renders, 0–255. */
function difference(first: Uint8Array, second: Uint8Array): number {
  let total = 0;
  for (let index = 0; index < first.length; index++) {
    total += Math.abs((first[index] ?? 0) - (second[index] ?? 0));
  }
  return total / first.length;
}

/**
 * What share of the square's edge band is lit at all, 0-1.
 *
 * This is what tells the two ways of reaching the edge apart. The sphere's own rim running off the
 * canvas would light a long arc of this band; what the spread and the chips throw past the limb on
 * a syllable lights a scatter of pixels across it. A mean cannot separate those, and since the
 * sphere was made nearly as wide as the screen the second happens on purpose.
 */
function edgeLitShare(pixels: Uint8Array, band: number): number {
  let lit = 0;
  let count = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (x >= band && x < SIZE - band && y >= band && y < SIZE - band) continue;
      if (luminance(pixels, (y * SIZE + x) * 4) > 8) lit++;
      count++;
    }
  }
  return lit / count;
}

/**
 * Red and blue summed over the square, how many pixels near the sphere are bluer than
 * they are red, and how many are nearly white.
 */
function colourCounts(pixels: Uint8Array) {
  const counts = { red: 0, blue: 0, blueOverRedNearSphere: 0, nearWhite: 0 };
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const index = (y * SIZE + x) * 4;
      const red = pixels[index] ?? 0;
      const blue = pixels[index + 2] ?? 0;
      counts.red += red;
      counts.blue += blue;
      if (radiusOf(x, y) < 1.2 && blue > red) counts.blueOverRedNearSphere++;
      if (red > 230 && (pixels[index + 1] ?? 0) > 230 && blue > 230) counts.nearWhite++;
    }
  }
  return counts;
}

/** How many bright pixels lie beyond 1.1 radii on the left half, where the film's chips fly. */
function brightBeyondLeftLimb(pixels: Uint8Array): number {
  let count = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE / 2; x++) {
      if (radiusOf(x, y) > 1.1 && luminance(pixels, (y * SIZE + x) * 4) > 100) count++;
    }
  }
  return count;
}

/** Brightness around a ring of radii, in 0.5° steps clockwise from 12 o'clock, minus its own running mean. */
function angularProfile(pixels: Uint8Array, inner: number, outer: number): number[] {
  const profile: number[] = [];
  for (let step = 0; step < 720; step++) {
    const angle = ((step / 2) * Math.PI) / 180;
    let total = 0;
    for (let sample = 0; sample < 8; sample++) {
      const radius = (inner + ((outer - inner) * sample) / 7) * RADIUS;
      const x = Math.round(SIZE / 2 + Math.sin(angle) * radius);
      const y = Math.round(SIZE / 2 - Math.cos(angle) * radius);
      total += (pixels[(y * SIZE + x) * 4] ?? 0) - (pixels[(y * SIZE + x) * 4 + 2] ?? 0);
    }
    profile.push(total / 8);
  }
  return profile.map((value, step) => {
    let local = 0;
    for (let offset = -10; offset <= 10; offset++) local += profile[(step + offset + 720) % 720] ?? 0;
    return value - local / 21;
  });
}

/** The clockwise turn, in degrees, that best lines `later` up with `earlier`. */
function bestTurn(earlier: number[], later: number[]): number {
  let best = { turn: 0, score: -Infinity };
  for (let shift = -40; shift <= 40; shift++) {
    let score = 0;
    for (let step = 0; step < 720; step++) {
      score += (earlier[step] ?? 0) * (later[(step + shift + 720) % 720] ?? 0);
    }
    if (score > best.score) best = { turn: shift / 2, score };
  }
  return best.turn;
}

/** Luminance of every pixel, 0–255. */
function lumas(pixels: Uint8Array): Float32Array {
  const values = new Float32Array(pixels.length / 4);
  for (let pixel = 0; pixel < values.length; pixel++) values[pixel] = luminance(pixels, pixel * 4);
  return values;
}

/** How many pixels in each of an 8×8 grid of tiles change by more than 40 luminance between two renders. */
function changedPerTile(first: Float32Array, second: Float32Array): number[] {
  const tile = SIZE / 8;
  const counts = new Array(64).fill(0);
  for (let pixel = 0; pixel < first.length; pixel++) {
    if (Math.abs((first[pixel] ?? 0) - (second[pixel] ?? 0)) <= 40) continue;
    counts[Math.floor(Math.floor(pixel / SIZE) / tile) * 8 + Math.floor((pixel % SIZE) / tile)]++;
  }
  return counts;
}

/**
 * The moments the slow script changes something: every epoch start. Epochs are 6 numbers
 * each in the scene (start, duration, dominant, line kind, density, red flash).
 */
function scriptBoundaries(scene: Hologram['scene']): number[] {
  const boundaries: number[] = [];
  for (let offset = 0; offset < scene.epochs.length; offset += 6) boundaries.push(scene.epochs[offset] ?? 0);
  return boundaries;
}

/**
 * How much more of any one tile changes across the 60 Hz frame step at `time` than across
 * the steps either side of it. Something that pops lights a patch at once; the ordinary
 * churn changes the same patch alike on either side.
 */
function largestJumpAt(time: number, hologram: Hologram): number {
  const frameSeconds = 1 / 60;
  const [first, second, third, fourth] = [-1.5, -0.5, 0.5, 1.5].map((shift) =>
    lumas(render(silence(Math.max(0, time + shift * frameSeconds)), hologram)),
  );
  if (!first || !second || !third || !fourth) throw new Error('Could not render the frames around the boundary');
  const before = changedPerTile(first, second);
  const across = changedPerTile(second, third);
  const after = changedPerTile(third, fourth);
  return Math.max(...across.map((count, tile) => count - Math.max(before[tile] ?? 0, after[tile] ?? 0)));
}

describe('the hologram', () => {
  it('draws something, and something golden rather than white or blue', () => {
    const pixels = render(speech(5, 0.7, spectrum('low', 0.7)));
    const colour = colourCounts(pixels);

    expect(brightness(pixels)).toBeGreaterThan(5);
    expect(colour.red).toBeGreaterThan(colour.blue * 1.5);
    // the film's sphere has no blue in it and next to no pure white
    expect(colour.blueOverRedNearSphere).toBe(0);
    expect(colour.nearWhite).toBeLessThanOrEqual(8);
  });

  it('moves while Jarvis is silent, so an idle screen still looks alive', () => {
    expect(difference(render(silence(1)), render(silence(2.5)))).toBeGreaterThan(1);
  });

  it('draws the same frame the same way every time', () => {
    expect(
      difference(render(speech(4.2, 0.5, spectrum('high', 0.5))), render(speech(4.2, 0.5, spectrum('high', 0.5)))),
    ).toBe(0);
  });

  it('draws a frame the same way after other frames on the same canvas, so nothing leaks between frames', () => {
    const hologram = mount();
    const first = render(speech(4.2, 0.5, spectrum('high', 0.5), 0.07, 12), hologram);
    for (let step = 0; step < 20; step++) {
      render(
        speech(step * 3.1, (step % 5) / 4, spectrum(step % 2 ? 'low' : 'high', 0.8), step * 0.013, step),
        hologram,
      );
    }

    expect(difference(first, render(speech(4.2, 0.5, spectrum('high', 0.5), 0.07, 12), hologram))).toBe(0);
  });

  it('builds the same scene from the same seed, so it looks the same every time the app opens', () => {
    expect(JSON.stringify(createHologramScene(SEED))).toBe(JSON.stringify(createHologramScene(SEED)));
  });

  it('holds its brightness while he speaks, and says so by moving instead', () => {
    // The film's rule, which this test pinned, then stopped pinning, and now pins again. The
    // sphere's brightness holds to a few percent through a spoken line — what changes is
    // behaviour, and the test below is the one that requires it. In between, the user could not
    // tell on a phone whether Jarvis was talking, so a glow was added and tuned six times; with
    // the sphere now most of the screen wide and the sparks drawn out into lines, the movement
    // carries it, and they have asked for the brightening gone.
    //
    // What is left is not quite zero, and should not be: speech throws chips past the limb, frays
    // the limb and swells the sphere, and all of those are more lit pixels. That is the film's own
    // few percent, and it comes from area rather than from anything being turned up.
    for (const time of [6, 13.4, 22.8]) {
      const silent = discBrightness(render(silence(time)));
      const ordinary = discBrightness(render(speech(time, 0.3, new Array(VOICE_BAND_COUNT).fill(0.27))));
      const loud = discBrightness(render(speech(time, 1, new Array(VOICE_BAND_COUNT).fill(0.9))));

      // Measured at PARTICLE_COUNT: 1.06-1.10 for an ordinary voice, 1.11-1.15 for a shout.
      //
      // **These numbers rise with the ceiling, and that is not a leak.** They were 1.03-1.06 and
      // 1.10-1.13 when the cap was a thousand fragments rather than three. Nothing about how a
      // fragment is lit changed; there are three times as many of them, so the chips thrown past the
      // limb, the frayed limb and the swell are all three times the extra area — and area is what
      // this measures. The check that the *strokes* are not turned up is the ratio staying far below
      // what a glow would do to it: speech at full volume brightens a thought-free sphere by 40% and
      // more when the glow is what is driving it, which is the next test but one.
      expect(ordinary / silent).toBeLessThan(1.12);
      expect(loud / silent).toBeLessThan(1.18);
      // And it does not *darken* while he talks either, which would read as him flinching.
      expect(ordinary / silent).toBeGreaterThan(0.95);
    }
  });

  it('shows speech as activity: chips thrown beyond the limb, and more change than when calm', () => {
    const bands = new Array(VOICE_BAND_COUNT).fill(0.7);
    for (const time of [6, 13.4, 22.8]) {
      // a protrusion the script has out at this moment is there in both, so count what the burst adds
      const calm = brightBeyondLeftLimb(render(silence(time)));
      const burst = brightBeyondLeftLimb(render(speech(time, 0.7, bands, 0.08, 3)));

      expect(burst - calm).toBeGreaterThan(200);
    }

    // Over a tenth of a second, the talking sphere changes clearly more than the calm one.
    let calmChange = 0;
    let talkingChange = 0;
    for (const time of [6, 9.3, 13.4, 17.1, 22.8]) {
      calmChange += difference(render(silence(time)), render(silence(time + 0.1)));
      talkingChange += difference(
        render(speech(time, 0.7, bands, 0.05, 7)),
        render(speech(time + 0.1, 0.7, bands, 0.15, 7)),
      );
    }

    expect(talkingChange).toBeGreaterThan(calmChange * 1.3);

    // And with no burst anywhere near — agitation alone, which is most of what a slowed-down
    // replay on an emulator ever sees — it still churns and frays clearly more than when calm.
    let agitatedChange = 0;
    for (const time of [6, 9.3, 13.4, 17.1, 22.8]) {
      agitatedChange += difference(render(speech(time, 0.7, bands)), render(speech(time + 0.1, 0.7, bands)));
    }

    expect(agitatedChange).toBeGreaterThan(calmChange * 1.3);
    // Some thirty full renders: about three seconds alone, and past bun's default five once the
    // whole workspace's tests share the machine. The budget is for that, not for a slow drawing.
  }, 30_000);

  it('shows which frequencies are sounding while he talks, not just that he is talking', () => {
    // Same moment, same overall level and agitation; only where the energy sits differs.
    const low = render(speech(7, 0.7, spectrum('low', 0.9)));
    const high = render(speech(7, 0.7, spectrum('high', 0.9)));

    // **The number falls as PARTICLE_COUNT rises, and it is the blending that does it**, not the
    // spectrum being answered any less. Fragments are Screen-blended, so a fragment's contribution
    // to a pixel is 1 - (1 - base)(1 - its own): the denser the swarm, the brighter the base under
    // every fragment, and the less any one of them moves the pixel it lands on. Measured over the
    // moments this suite renders: 0.71 at a thousand fragments, 0.65 at five thousand, 0.52-0.66 at
    // ten, 0.47-0.54 at fifteen. Nothing saturates at any of them — compression, not clipping.
    //
    // So this is measured rather than reasoned, and it keeps its teeth: the same spectrum rendered
    // twice differs by exactly 0, which is what ignoring the bands would score. Under the 0.52 the
    // sparsest moment measures rather than at it, because a threshold a test clears by three
    // percent is a threshold that fails on the next unrelated thing.
    expect(difference(low, high)).toBeGreaterThan(0.45);
  });

  it('turns its body about the vertical axis, once every BODY_TURN_SECONDS', () => {
    // The ball itself turning is what says it is alive, so the rate is pinned rather than left
    // to a constant nobody would notice going to zero. It is a globe spin, not a roll in the
    // screen plane, so it leaves no single angle for the rim check below to find — which is why
    // that check no longer looks at the body at all.
    expect(bodyTurnRadians(0)).toBe(0);
    expect(bodyTurnRadians(BODY_TURN_SECONDS)).toBeCloseTo(2 * Math.PI, 6);
    expect(bodyTurnRadians(BODY_TURN_SECONDS / 4)).toBeCloseTo(Math.PI / 2, 6);
    // and it never stalls or runs backwards
    let previous = -1;
    for (let time = 0; time <= 30; time += 0.25) {
      const turn = bodyTurnRadians(time);
      expect(turn).toBeGreaterThan(previous);
      previous = turn;
    }
  });

  it('turns its rim clockwise at the film rate', () => {
    // The film's rim layer rolls at 10-12°/s, so 5-6° in half a second, whichever element
    // leads: on the script this seed builds, the crescent leads at 3 s, the thin ring at
    // 19 s and the ladder ring at 36 s, each well clear of its handover.
    for (const time of [3, 19, 36]) {
      const earlier = render(silence(time));
      const later = render(silence(time + 0.5));

      expect(bestTurn(angularProfile(earlier, 0.92, 1.1), angularProfile(later, 0.92, 1.1))).toBeWithin(4.5, 6.5);
    }
  });

  it('turns its inner shells against the rim, at the rate the film measured', () => {
    // This used to be checked in the pixels, as "the band round the core must not follow the
    // rim". That band is full of the fragment body, and the body now turns about the vertical
    // axis on purpose, so a rotation estimator pointed at it is reading the body rather than the
    // shells and answers differently as the texture changes — it moved from 2.0 to 2.5 when the
    // halo became a ramp, which says nothing about whether anything follows the rim.
    //
    // What the design actually promises is here instead: the shells turn the other way from the
    // rim, at the -2 to -6°/s the film measured (section 3), and the rim rolls the other way.
    expect(SHELL_DEGREES_PER_SECOND).toBeLessThan(0);
    expect(SHELL_DEGREES_PER_SECOND).toBeGreaterThanOrEqual(-6);
    expect(ROLL_DEGREES_PER_SECOND).toBeGreaterThan(0);
  });

  it('arrives as a vortex out of its core, and nothing else', () => {
    // The whole of the arrival, at the user's asking: no point of light, no sparks, no spoked
    // dial — his particles leave the core, nearest first, and spiral out to where they sit.
    const hologram = mount();
    const at = (appearance: number) => render({ ...silence(3), appearance }, hologram);
    const formed = at(1);

    expect(brightness(at(0))).toBeLessThan(0.5);
    // Early on the light is still gathered at the core, and it spreads outward steadily.
    const reaches = [0.2, 0.4, 0.6, 0.8, 1].map((appearance) => lightReach(at(appearance)));
    for (let step = 1; step < reaches.length; step++) {
      expect(reaches[step]).toBeGreaterThan(reaches[step - 1]);
    }
    expect(reaches[0]).toBeLessThan(reaches[reaches.length - 1] * 0.5);
    expect(difference(at(0.999), formed)).toBeLessThan(0.5);
  });

  it('spirals out only the particles it is drawing, so a thinned swarm arrives thinned', () => {
    // The vortex moves particles; it never adds any. A device drawing a share of the scene sees
    // that share arrive. The core, the whorl and the rim are not particles and are not thinned, so
    // the frame as a whole dims by less than the share does — but it has to dim.
    const hologram = mount();
    const midway = (density: number) => brightness(render({ ...silence(3), appearance: 0.5, density }, hologram));
    expect(midway(0.3)).toBeLessThan(midway(1) * 0.9);
  });

  it('brings its rim elements and protrusions in and out smoothly, with nothing popping at a script boundary', () => {
    const hologram = mount();
    for (const boundary of scriptBoundaries(hologram.scene)) {
      expect(largestJumpAt(boundary, hologram)).toBeLessThan(30);
    }
  });

  it('materialises without a flash: no one frame of it turns a tenth of the light on at once', () => {
    const hologram = mount();
    // The arrival is the vortex over MATERIALISE_SECONDS, and the script-boundary test above never
    // sees it, because it only walks a formed ball. An arrival so steep it jumped would read
    // as a flash: none of its frames may move a tenth of the light on in one.
    //
    // Measured as a share of the same moment fully formed, not of the formed ball at rest. The
    // script has one deliberate step in it — a red flash, two film frames long and off again,
    // straight out of the film — and it lands about a second in, which is inside this window.
    // Comparing each frame with itself at appearance 1 divides out everything time drives, the
    // flash included, and leaves exactly what this test is about: how fast the ball itself
    // arrives. It is the stricter measure of the two, since the denominator is no longer a ball
    // brighter than the one being walked past.
    let previous = 0;
    let worst = 0;
    for (let frame = 1; frame <= Math.round(60 * (MATERIALISE_SECONDS + 0.4)); frame++) {
      const time = frame / 60;
      const appearance = Math.min(1, time / MATERIALISE_SECONDS);
      const formedNow = brightness(render(silence(time), hologram));
      const share = brightness(render({ ...silence(time), appearance }, hologram)) / formedNow;
      worst = Math.max(worst, Math.abs(share - previous));
      previous = share;
    }

    expect(worst).toBeLessThan(0.1);
    // Two renders a frame for a hundred and ten frames, of a sphere that now fills nearly the
    // whole square: the slowest test here by an order, and it runs past the default five seconds.
  }, 60_000);

  it('thinks by sweeping a plane up through itself, which is like nothing else it does', () => {
    // The state the user asked to be "completely different". Everything else the sphere does is
    // some mixture of turning, churning and glowing; this is a plane travelling from the bottom of
    // the ball to the top, lighting only what it passes, with the whorl and the rim receded behind
    // it. What is pinned is the travel: where the light sits has to climb through a pass.
    const hologram = mount();
    const thought = (time: number) => render({ ...silence(time), thinking: 1 }, hologram);
    // Sampled right across *one* pass — SCAN_SECONDS is 2.6, so this one runs from 5.2 to 7.8 —
    // and the trend across it is what is asserted, rather than three instants being strictly
    // ordered. They are not, and expecting them to be was the test's mistake rather than the
    // drawing's: the plane lights whatever it passes, and what it passes is a lumpy swarm, so the
    // centre of the light steps sideways whenever it crosses a dense band. Between 5.4 s and 6.3 s
    // it moves by under a fiftieth of the square, in whichever direction that band happens to fall.
    // Over the pass as a whole it moves twenty times that, every time.
    const across = [5.4, 5.8, 6.2, 6.6, 7.0, 7.4].map((time) => lightHeight(thought(time)));
    const early = across.slice(0, 3);
    const late = across.slice(3);
    const mean = (of: number[]) => of.reduce((all, one) => all + one, 0) / of.length;

    expect(mean(early)).toBeGreaterThan(mean(late));
    // Every sample in the second half is above every sample in the first: a climb rather than a
    // drift, without requiring any two neighbours to be in order.
    expect(Math.max(...late)).toBeLessThan(Math.min(...early));
    // A real move, not a wobble — and measured in sphere radii rather than in fractions of the
    // square, because the square is set by how far the chips fly and has nothing to do with this.
    // It comes to about a sixth of a radius, which is less than the plane itself travels because
    // the core, the rim and the shadow stay where they are and hold the centre of the light toward
    // the middle. Bounded below that with room, not against it.
    expect(((mean(early) - mean(late)) * SIZE) / RADIUS).toBeGreaterThan(0.12);
  });

  it('thinks without glowing, so a thought is never mistaken for a word', () => {
    // Speech brightens the ball by 40% and more, deliberately. A thought must not, or the two
    // states say the same thing to anyone glancing at the screen.
    const hologram = mount();
    for (const time of [5.4, 6.3, 7.2]) {
      const calm = discBrightness(render(silence(time), hologram));
      const thought = discBrightness(render({ ...silence(time), thinking: 1 }, hologram));

      expect(thought).toBeLessThan(calm);
    }
  });

  it('listens with a faint ring outside the limb that follows how loud they are, and leaves the ball alone', () => {
    // Someone talking to him is shown as a sign that he hears them, not as anything he does: a ring
    // of ticks just past the limb whose reach follows their voice. The ball itself must not change,
    // or listening would read as him speaking.
    const hologram = mount();
    const time = 5.4;
    const ringLight = (pixels: Uint8Array) => {
      let total = 0;
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const radius = radiusOf(x, y);
          if (radius > 1.06 && radius < 1.2) total += luminance(pixels, (y * SIZE + x) * 4);
        }
      }
      return total;
    };
    const calm = render(silence(time), hologram);
    const quiet = render({ ...silence(time), hearing: 1, hearingLevel: 0.1 }, hologram);
    const loud = render({ ...silence(time), hearing: 1, hearingLevel: 1 }, hologram);

    expect(ringLight(quiet)).toBeGreaterThan(ringLight(calm));
    expect(ringLight(loud)).toBeGreaterThan(ringLight(quiet) * 1.3);
    expect(Math.abs(discBrightness(loud) - discBrightness(calm))).toBeLessThan(0.5);
    // Subtle: the whole square brightens by a small share, where speech brightens the ball itself.
    expect(brightness(loud)).toBeLessThan(brightness(calm) * 1.15);
  });

  it('leaves by shrinking and fading, and takes his shadow with him', () => {
    // The way out is the way in, run backwards and quicker: the whole sphere fades and draws back
    // toward the middle rather than being cut off where it stands. Gone means gone — including the
    // shadow, which is inside the same fade, or a dark circle would be left on the home screen for
    // a moment after Jarvis was no longer on it.
    const hologram = mount();
    // On black for the fade itself, because on a bright screen a *weakening shadow* makes the mean
    // go up as he leaves, and that would be measuring the shadow rather than him.
    const here = brightness(render({ ...silence(6), presence: 1 }, hologram));
    const halfway = brightness(render({ ...silence(6), presence: 0.5 }, hologram));
    // ...and over a bright screen for the ending, where what matters is that nothing is left on it.
    const gone = render({ ...silence(6), presence: 0 }, hologram, '#8fb3ae');
    const background = luminance(gone, 0);

    expect(halfway).toBeLessThan(here * 0.75);
    // Nothing of him, and nothing of his shadow: every pixel back to the screen behind.
    for (let index = 0; index < gone.length; index += 4) {
      expect(luminance(gone, index)).toBeCloseTo(background, 0);
    }
  });

  it('thins to a share of its particles without rearranging the ones that stay', () => {
    // The phone decides how many it can afford while it draws them (`density-control.ts`), so the
    // share moves while you are looking at it. Which particles are in has to be decided by each
    // one's own id rather than by where it falls in the list: as the share rises the swarm must
    // thicken, not reshuffle, or every adjustment would be a visible jolt.
    const hologram = mount();
    const thin = render({ ...silence(6), density: 0.4 }, hologram);
    const thick = render({ ...silence(6), density: 0.8 }, hologram);
    const whole = render(silence(6), hologram);

    // Fewer particles is less light, in order.
    expect(brightness(thin)).toBeLessThan(brightness(thick));
    expect(brightness(thick)).toBeLessThan(brightness(whole));

    // And every pixel the thin one lights, the thick one lights at least as much: nothing that was
    // there has moved or gone out. Allowing for antialiasing where a new neighbour darkens an edge.
    let dimmed = 0;
    for (let index = 0; index < thin.length; index += 4) {
      if (luminance(thin, index) > luminance(thick, index) + 12) {
        dimmed++;
      }
    }
    expect(dimmed / (thin.length / 4)).toBeLessThan(0.002);
  });

  it('can be built with far fewer particles, which is the only way a watch gets cheaper', () => {
    // The density share thins the swarm by skipping fragments *inside* the draw loop, so however
    // low it goes the loop still visits every fragment the scene holds — and the scene is
    // serialised into the worklet runtime at mount besides. Neither cost can be steered away from,
    // which is why `watch/src/watch-density.ts` asks for a smaller scene rather than a lower share.
    const watchSized = createHologramScene(SEED, 1200);

    expect(watchSized.body.length).toBeLessThan(createHologramScene(SEED).body.length);
    // And it is still him: the rim, the stream and the rest do not thin with the body.
    expect(watchSized.stream.length).toBe(createHologramScene(SEED).stream.length);
    expect(watchSized.body.length).toBeGreaterThan(0);
  });

  it('can be built with more particles than any phone is given', () => {
    // Nothing about the scene knows what a phone can hold, so a renderer with no frame to hit can
    // ask for whatever it likes above the apps' ceiling — see `hologram/.scripts/render-showcase.ts`,
    // which does exactly that for its cover. The parameter is the *body*, which is nearly all of
    // him; the rim, the stream and the rest are fixed, so this asks that more were asked for and
    // more arrived, rather than for an exact multiple.
    const asked = PARTICLE_COUNT * 1.3;
    const bigger = createHologramScene(SEED, asked);

    expect(bigger.body.length).toBeGreaterThan(createHologramScene(SEED).body.length);
    // Every fragment is the same number of values wide, so the count is exactly proportional.
    expect(bigger.body.length).toBe(Math.round(createHologramScene(SEED).body.length * 1.3));

    // And it still draws: the same frame, a denser swarm, nothing thrown outside the square.
    const dense = render(silence(6), { scene: bigger, resources: createHologramResources(Skia, bigger) });
    expect(brightness(dense)).toBeGreaterThan(brightness(render(silence(6))));
  });

  it('stays inside its square even at full volume, chips and all', () => {
    // Strict again, and the round trip is worth recording. It began this way and held at
    // SPHERE_FRACTION 0.27. The user then asked for Jarvis as wide as the screen, and at 0.35 the
    // chips thrown to about 1.6R on a syllable were cut off in mid-air — so the rule was loosened
    // to let a few pixels of the band light up, telling a clipped chip from a clipped rim by how
    // much of the band was lit.
    //
    // Then the user saw the clipping and said so, and the answer turned out not to be a looser
    // rule but a wider square: the square is bigger than the *screen* now, so the only thing that
    // cuts a chip is the screen itself, where an edge cannot be seen.
    //
    // **The ten-pixel allowance is doing real work now, and it is worth knowing how much.** It
    // measured none of the band at five thousand fragments. At ten thousand the worst moment of the
    // worst burst lights seven pixels of 5020 — inside the allowance, but only just — and at
    // fifteen thousand it lit ninety and this failed. More fragments are more draws from the same
    // distribution, so the tail reaches further: 1.81R here against 1.79R at five thousand.
    //
    // What reaches out there is the speech-driven spread, not the chips: removing the burst
    // entirely changes nothing. And the square's own edge is 1.85R while *the screen ends at
    // 1.24R*, so all of it is half again further out than anything the user can see. That is why
    // seven pixels is a note rather than a bug — but the allowance is the thing to re-measure,
    // rather than widen, the next time this trips.
    //
    // It keeps its teeth either way. Shrink the square to the 1.61R that clipped visibly and the
    // band lights 0.0998 of itself — 501 pixels, seventy times this — and at 1.37R, 0.251. A rim
    // running off the canvas is an arc, not a spray.
    const band = Math.round(SIZE * 0.02);
    for (const time of [8, 23.4, 31.2, 47.9, 55.1]) {
      for (const burstAge of [0, 0.06, 0.12, 0.2]) {
        const loudest = render(speech(time, 1, new Array(VOICE_BAND_COUNT).fill(1), burstAge, Math.round(time * 10)));

        expect(edgeLitShare(loudest, band)).toBeLessThan(0.002);
      }
    }
  });
});
