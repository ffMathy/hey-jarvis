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
 * materialises from nothing without a flash, that nothing pops in or out as its slow
 * script moves on, and that it stays inside its square.
 */

const SIZE = 256;
const SEED = 1337;
/** The sphere's radius in pixels: the drawing makes it 0.31 of the square. */
const RADIUS = SIZE * 0.31;

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
function render(frame: HologramFrame, hologram: Hologram = mount()): Uint8Array {
  const surface = Skia.Surface.MakeOffscreen(SIZE, SIZE) ?? Skia.Surface.Make(SIZE, SIZE);
  if (!surface) {
    throw new Error('Could not create a surface to draw on');
  }

  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('#000000'));
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

/** Mean luminance of the outermost `band` pixels on every side. */
function edgeBrightness(pixels: Uint8Array, band: number): number {
  let total = 0;
  let count = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (x >= band && x < SIZE - band && y >= band && y < SIZE - band) continue;
      total += luminance(pixels, (y * SIZE + x) * 4);
      count++;
    }
  }
  return total / count;
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

  it('glows plainly the moment he speaks, without becoming a level meter', () => {
    // NOT the film, deliberately. The film's disc holds to ±3% through "Doctor." and shows
    // speech as activity alone, which this test used to pin. The user asked for the first
    // hologram's glow back — alongside the chips and the churn, not instead of them.
    //
    // The thing that matters is the *step* between silent and speaking, not the slope with
    // loudness. Driving the glow by loudness alone lifted the disc 5-8% at the levels ordinary
    // speech reaches, and the user reported seeing no change at all; it rides the agitation
    // envelope now, so any speech lights it. What must not come back is a sphere whose
    // brightness swings with every syllable, so the two bounds below are: an ordinary speaking
    // voice is clearly brighter than silence, and shouting is barely brighter than murmuring.
    for (const time of [6, 13.4, 22.8]) {
      const silent = discBrightness(render(silence(time)));
      const ordinary = discBrightness(render(speech(time, 0.3, new Array(VOICE_BAND_COUNT).fill(0.27))));
      const loud = discBrightness(render(speech(time, 1, new Array(VOICE_BAND_COUNT).fill(0.9))));

      // An ordinary speaking voice is plainly brighter than silence...
      expect(ordinary / silent).toBeGreaterThan(1.15);
      // ...and even shouting stays this side of a flare...
      expect(loud / silent).toBeLessThan(1.5);
      // ...with loudness itself barely moving it, which is what keeps it from being a meter.
      expect(loud / ordinary).toBeLessThan(1.15);
      expect(loud).toBeGreaterThan(ordinary);
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
  });

  it('shows which frequencies are sounding while he talks, not just that he is talking', () => {
    // Same moment, same overall level and agitation; only where the energy sits differs.
    const low = render(speech(7, 0.7, spectrum('low', 0.9)));
    const high = render(speech(7, 0.7, spectrum('high', 0.9)));

    expect(difference(low, high)).toBeGreaterThan(0.5);
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
      // Round the core, where the whorl turns the other way, nothing may follow the rim: this
      // band either stands still or drifts counter-clockwise.
      expect(bestTurn(angularProfile(earlier, 0.35, 0.6), angularProfile(later, 0.35, 0.6))).toBeLessThanOrEqual(1.5);
    }
  });

  it('materialises from nothing, and leaves nothing of the intro behind once formed', () => {
    const formed = brightness(render(silence(2.7)));

    expect(brightness(render({ ...silence(0), appearance: 0 }))).toBeLessThan(0.5);
    // the spoked dial is up a quarter of the way through the keyframes, well short of the ball
    const dial = brightness(render({ ...silence(0.9), appearance: 0.25 }));
    expect(dial).toBeGreaterThan(2);
    expect(dial).toBeLessThan(formed * 0.5);
    // the ball is dense by 2.7 s, before the crescent has grown back in
    expect(brightness(render({ ...silence(2.7), appearance: 0.75 }))).toBeGreaterThan(formed * 0.8);
    expect(difference(render({ ...silence(3.6), appearance: 0.999 }), render(silence(3.6)))).toBeLessThan(0.5);
  });

  it('brings its rim elements and protrusions in and out smoothly, with nothing popping at a script boundary', () => {
    const hologram = mount();
    for (const boundary of scriptBoundaries(hologram.scene)) {
      expect(largestJumpAt(boundary, hologram)).toBeLessThan(30);
    }
  });

  it('materialises without a flash: no one frame of it turns a tenth of the light on at once', () => {
    const hologram = mount();
    // The materialisation holds the drawing's largest one-frame steps — the dial snapping on and
    // breaking up, the fill arriving, the rim layer coming in — and the script-boundary test
    // above never sees them, because it only walks a formed ball. The film's dial "snaps on
    // within two film frames", about five at 60 Hz, so even the sharpest keyframe here should
    // spread over several: none of them may move a tenth of the formed ball's light in one.
    const formed = brightness(render(silence(5), hologram));
    let previous = brightness(render({ ...silence(0), appearance: 0 }, hologram));
    let worst = 0;
    for (let frame = 1; frame <= Math.round(60 * (MATERIALISE_SECONDS + 0.4)); frame++) {
      const time = frame / 60;
      const appearance = Math.min(1, time / MATERIALISE_SECONDS);
      const now = brightness(render({ ...silence(time), appearance }, hologram));
      worst = Math.max(worst, Math.abs(now - previous) / formed);
      previous = now;
    }

    expect(worst).toBeLessThan(0.1);
  });

  it('stays inside its square even at full volume, rather than being clipped at the edges', () => {
    const band = Math.round(SIZE * 0.02);
    for (const time of [8, 23.4, 31.2, 47.9, 55.1]) {
      for (const burstAge of [0, 0.06, 0.12, 0.2]) {
        const loudest = render(speech(time, 1, new Array(VOICE_BAND_COUNT).fill(1), burstAge, Math.round(time * 10)));

        expect(edgeBrightness(loudest, band)).toBeLessThan(2);
      }
    }
  });
});
