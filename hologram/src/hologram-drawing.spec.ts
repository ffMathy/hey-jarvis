import { beforeAll, describe, expect, it } from 'bun:test';
import { AlphaType, ColorType } from '@shopify/react-native-skia/lib/module/skia/types';
import { JsiSkApi } from '@shopify/react-native-skia/lib/module/skia/web';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web/LoadSkiaWeb';
import { advanceFrameClock, createFrameClockState, hologramFrameOf, restartArrival } from './frame-clock';
import { MATERIALISE_SECONDS } from './frame-timing';
import {
  analyseFrame,
  arrivalOf,
  BODY_TURN_SECONDS,
  bodyTurnRadians,
  createHologramResources,
  createHologramScene,
  createReleasableHologramResources,
  drawHologram,
  type HologramFrame,
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

  it('says the greeting while it arrives without throwing anything off a limb that is not there yet', () => {
    // The greeting plays during the vortex. Chips, fraying and the split crescent are what speech
    // does to a formed ball; early in the vortex there is no limb for them to leave, so a frame
    // spoken over must look like the same frame in silence.
    const hologram = mount();
    const bands = spectrum('low', 0.8);
    for (const appearance of [0.2, 0.4]) {
      const silent = render({ ...silence(0.5), appearance }, hologram);
      const spoken = render({ ...speech(0.5, 0.9, bands, 0.05, 3), appearance }, hologram);
      expect(brightBeyondLeftLimb(spoken)).toBeLessThanOrEqual(brightBeyondLeftLimb(silent) + 1);
    }
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

  it('can be built with far fewer particles, which is what makes a watch cheaper to mount', () => {
    // The scene is built, put in the share's order and serialised into the worklet runtime at mount,
    // whatever share of it is drawn. That cost cannot be steered away from, which is why the watch's
    // screens pass `WATCH_PARTICLE_COUNT` as the view's `particleCount` rather than relying on a
    // lower share.
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

/**
 * A Skia over CanvasKit that knows which of the paths it made are still alive: the ones nobody
 * has disposed. Nothing else frees them there — see createReleasableHologramResources.
 */
function countingSkia() {
  const alive = new Set<object>();
  const Path = new Proxy(Skia.Path, {
    get(target, property, receiver) {
      if (property !== 'MakeFromCmds') return Reflect.get(target, property, receiver);
      const makeFromCmds: typeof target.MakeFromCmds = (commands) => {
        const path = target.MakeFromCmds(commands);
        if (path === null) return path;
        alive.add(path);
        const dispose = path.dispose.bind(path);
        path.dispose = () => {
          alive.delete(path);
          dispose();
        };
        return path;
      };
      return makeFromCmds;
    },
  });
  return { skia: { ...Skia, Path }, alive };
}

describe('letting go of paths by hand, for CanvasKit', () => {
  /**
   * Frames in threes: the rim fading in as he arrives changes the ladder ring's weight between
   * one three and the next, so its paths are rebuilt, and holds it within one, so they are reused.
   */
  const frames = Array.from({ length: 24 }, (_, index) => ({
    ...speech(2 + index / 72, 0.5, spectrum('high', 0.6), 0.2, 3),
    appearance: Math.min(1, 0.64 + Math.floor(index / 3) * 0.06),
  }));

  it('lets go of every path a frame made once it is drawn, and keeps what the next frame reuses', () => {
    const counting = countingSkia();
    const scene = createHologramScene(SEED);
    const releasable = createReleasableHologramResources(counting.skia, scene);
    const lasting = counting.alive.size;
    const plain = mount();
    const weights = new Set<number>();
    for (const frame of frames) {
      const released = render(frame, { scene, resources: releasable.resources });
      releasable.release();
      // The ladder ring's five paths are all that may outlive the frame that built them.
      expect(counting.alive.size - lasting).toBeLessThanOrEqual(5);
      expect(difference(released, render(frame, plain))).toBe(0);
      weights.add(releasable.resources.trussCache.weight);
    }
    expect(weights.size).toBeGreaterThan(3);
  });

  it('deletes everything it made, paints and all, when disposed', () => {
    const counting = countingSkia();
    const scene = createHologramScene(SEED);
    const releasable = createReleasableHologramResources(counting.skia, scene);
    render(speech(4.2, 0.5, spectrum('low', 0.5)), { scene, resources: releasable.resources });
    releasable.dispose();
    expect(counting.alive.size).toBe(0);
    expect(() => releasable.resources.thinRingStroke.setAlphaf(0.5)).toThrow();
    // A second dispose finds nothing left to delete, rather than deleting it twice.
    releasable.dispose();
  });
});

/**
 * Renders a frame as the view on a phone does — inside one layer, on its background if it has one —
 * and returns its pixels premultiplied, so that a faint pixel on a see-through canvas is compared as
 * the light it is rather than blown up by dividing out its alpha.
 */
function renderAsTheView(
  frame: HologramFrame,
  hologram: Hologram,
  background: string | undefined,
  fadeOutside: boolean,
): Uint8Array {
  const surface = Skia.Surface.MakeOffscreen(SIZE, SIZE) ?? Skia.Surface.Make(SIZE, SIZE);
  if (!surface) {
    throw new Error('Could not create a surface to draw on');
  }
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('#00000000'));
  canvas.saveLayer(undefined, Skia.XYWHRect(0, 0, SIZE, SIZE));
  if (background !== undefined) {
    canvas.drawColor(Skia.Color(background));
  }
  drawHologram(canvas, SIZE, frame, hologram.scene, hologram.resources, fadeOutside);
  canvas.restore();
  return snapshotOf(surface);
}

/**
 * The picture drawn with `fadeOutside` on a see-through canvas, then faded as one group by `alpha`
 * over `background` (or over nothing): what the view does with the GPU body beside it, where the
 * wrapper round both canvases carries the fade and the view behind it carries the colour.
 */
function fadedAsAGroup(frame: HologramFrame, hologram: Hologram, background: string | undefined, alpha: number) {
  const picture = Skia.Surface.MakeOffscreen(SIZE, SIZE) ?? Skia.Surface.Make(SIZE, SIZE);
  const shown = Skia.Surface.MakeOffscreen(SIZE, SIZE) ?? Skia.Surface.Make(SIZE, SIZE);
  if (!picture || !shown) {
    throw new Error('Could not create a surface to draw on');
  }
  const canvas = picture.getCanvas();
  canvas.clear(Skia.Color('#00000000'));
  drawHologram(canvas, SIZE, frame, hologram.scene, hologram.resources, true);
  picture.flush();
  const image = picture.makeImageSnapshot();
  const fade = Skia.Paint();
  fade.setAlphaf(alpha);
  const view = shown.getCanvas();
  view.clear(Skia.Color(background ?? '#00000000'));
  view.drawImage(image, 0, 0, fade);
  return snapshotOf(shown);
}

function snapshotOf(surface: NonNullable<ReturnType<typeof Skia.Surface.Make>>): Uint8Array {
  surface.flush();
  const pixels = surface.makeImageSnapshot().readPixels(0, 0, {
    width: SIZE,
    height: SIZE,
    alphaType: AlphaType.Premul,
    colorType: ColorType.RGBA_8888,
  });
  if (!(pixels instanceof Uint8Array)) {
    throw new Error('Could not read the pixels back');
  }
  return pixels;
}

/** The most any one channel of any one pixel differs by between two renders, 0–255. */
function largestDifference(first: Uint8Array, second: Uint8Array): number {
  let largest = 0;
  for (let index = 0; index < first.length; index++) {
    largest = Math.max(largest, Math.abs((first[index] ?? 0) - (second[index] ?? 0)));
  }
  return largest;
}

/** The appearance at which {@link arrivalOf} reaches `share` while he arrives, found by halving. */
function appearanceArrivedBy(share: number): number {
  let low = 0;
  let high = 1;
  for (let step = 0; step < 60; step++) {
    const middle = (low + high) / 2;
    if (arrivalOf(middle, 1) < share) low = middle;
    else high = middle;
  }
  return high;
}

describe('fading him outside the drawing, for a view that lays the GPU body beside it', () => {
  /** Half arrived, nearly arrived and half gone, each with the arrival it should come to. */
  const fades = [
    { arrival: 0.5, frame: { ...speech(4.3, 0.8, spectrum('low', 0.6)), appearance: appearanceArrivedBy(0.5) } },
    { arrival: 0.9, frame: { ...speech(4.3, 0.8, spectrum('low', 0.6)), appearance: appearanceArrivedBy(0.9) } },
    { arrival: 0.5, frame: { ...speech(4.3, 0.8, spectrum('low', 0.6)), presence: 0.5 } },
  ];

  it('draws the very same picture at rest, whichever does the fading, on any background', () => {
    const hologram = mount();
    for (const frame of [silence(6), speech(4.3, 0.8, spectrum('low', 0.6), 0.05, 2)]) {
      expect(arrivalOf(frame.appearance, frame.presence)).toBe(1);
      for (const background of [undefined, '#000000', '#0b1220']) {
        const inside = renderAsTheView(frame, hologram, background, false);
        const outside = renderAsTheView(frame, hologram, background, true);
        expect(difference(inside, outside)).toBe(0);
      }
    }
  });

  it('comes out as its own fade does once the whole of it is faded by the arrival, over black or over nothing', () => {
    const hologram = mount();
    for (const { arrival, frame } of fades) {
      const alpha = arrivalOf(frame.appearance, frame.presence);
      expect(alpha).toBeCloseTo(arrival, 9);
      for (const background of ['#000000', undefined]) {
        const drawingsOwn = renderAsTheView(frame, hologram, background, false);
        // The fade is far from nothing at these moments, so matching it means something.
        expect(largestDifference(drawingsOwn, renderAsTheView(frame, hologram, background, true))).toBeGreaterThan(20);
        expect(largestDifference(drawingsOwn, fadedAsAGroup(frame, hologram, background, alpha))).toBeLessThanOrEqual(
          4,
        );
      }
    }
  });

  it('is the arrival analyseFrame works out, all the way through arriving, staying and leaving', () => {
    // A guard against analyseFrame working its arrival out again for itself, which could drift.
    const scene = createHologramScene(SEED);
    const frames = framesFromTheClock();
    const arrivals = frames.map((frame) => arrivalOf(frame.appearance, frame.presence));
    const analysed = frames.map((frame) => analyseFrame(frame, SIZE, scene).arrival);

    expect(arrivals.every((arrival, index) => Object.is(arrival, analysed[index]))).toBe(true);
    // Through all of it: not there, partly there and wholly there.
    expect(arrivals).toContain(0);
    expect(arrivals).toContain(1);
    expect(arrivals.some((arrival) => arrival > 0 && arrival < 1)).toBe(true);
  });

  it('is the arrival as it was before it was taken out of analyseFrame: out of range, not a number, infinite', () => {
    for (const appearance of [-1, 0, 0.05, 0.1, 0.2, 1, 7, Number.NaN, Number.POSITIVE_INFINITY]) {
      for (const presence of [-1, 0, 0.3, 1, 2, Number.NaN, Number.NEGATIVE_INFINITY]) {
        expect(Object.is(arrivalOf(appearance, presence), arrivalAsItWas(appearance, presence))).toBe(true);
      }
    }
  });

  it('fades the whole of him in over the first fifth of the vortex, and out with his presence', () => {
    expect(arrivalOf(0, 1)).toBe(0);
    expect(arrivalOf(0.1, 1)).toBe(0.5);
    expect(arrivalOf(0.2, 1)).toBe(1);
    expect(arrivalOf(1, 0.3)).toBe(0.3);
  });
});

/**
 * The arrival as `analyseFrame` worked it out before `arrivalOf` was taken out of it, with the two
 * helpers it read copied line for line, as the reference `arrivalOf` is held to. It is frozen on
 * purpose: the phone and the watch must not fade him differently because the code moved.
 */
function arrivalAsItWas(appearance: number, presence: number) {
  const clamp01 = (value: number) => (value > 0 ? (value > 1 ? 1 : value) : 0);
  const smooth01 = (value: number) => {
    const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
    return clamped * clamped * (3 - 2 * clamped);
  };
  const swirl = clamp01(appearance);
  return smooth01(swirl / 0.2) * clamp01(presence);
}

/**
 * The frames the frame clock hands the drawing at 60 a second through two arrivals that stay and two
 * that leave halfway through: each one copied, since the clock's frame is only good until its next step.
 */
function framesFromTheClock(): HologramFrame[] {
  const clock = createFrameClockState();
  const silent = new Array(VOICE_BAND_COUNT).fill(0);
  const frames: HologramFrame[] = [];
  for (const leaving of [false, true, false, true]) {
    restartArrival(clock);
    for (let step = 0; step < 90; step++) {
      advanceFrameClock(clock, 1 / 60, 0, silent, false, false, leaving && step > 45, 0, 0);
      const frame = hologramFrameOf(clock);
      frames.push({ ...frame, bands: [...frame.bands] });
    }
  }
  return frames;
}
