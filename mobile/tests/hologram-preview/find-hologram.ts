/**
 * Finds the hologram in a screenshot, by its colour.
 *
 * `uiautomator dump` cannot be used for this: it waits for the UI to go idle, and
 * a screen that redraws every frame never does, so on the conversation screen it
 * fails and leaves the previous dump behind. A screenshot has no such problem.
 * The hologram is the only golden thing on a near-black screen, so the box around
 * its golden pixels is where it is.
 *
 * Prints `left top width height` in screen pixels, or exits 1 if there is no
 * hologram-sized golden region.
 *
 * Usage: bun find-hologram.ts <screenshot PNG>
 */
import { readFileSync } from 'node:fs';
import { JsiSkApi } from '@shopify/react-native-skia/lib/module/skia/web';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web/LoadSkiaWeb';

/** Ignore the status bar, whose icons can be any colour. */
const TOP_MARGIN_FRACTION = 0.06;
/** A region this much smaller than the screen width is not the hologram. */
const MINIMUM_SIZE_FRACTION = 0.3;

interface CanvasKitGlobal {
  CanvasKit: Parameters<typeof JsiSkApi>[0];
}

function hasCanvasKit(scope: object): scope is CanvasKitGlobal {
  return 'CanvasKit' in scope;
}

/** Amber and gold: red strong, blue well below it, green in between. */
function isGolden(red: number, green: number, blue: number): boolean {
  return red > 110 && green > 60 && red > blue * 1.6 && green > blue * 1.2;
}

const [file] = process.argv.slice(2);
if (!file) {
  throw new Error('Usage: bun find-hologram.ts <screenshot PNG>');
}

await LoadSkiaWeb();
if (!hasCanvasKit(globalThis)) {
  throw new Error('CanvasKit did not load');
}
const Skia = JsiSkApi(globalThis.CanvasKit);

const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(new Uint8Array(readFileSync(file))));
if (!image) {
  throw new Error(`${file} is not an image`);
}
const width = image.width();
const height = image.height();
const pixels = image.readPixels();
if (!(pixels instanceof Uint8Array)) {
  throw new Error(`Could not read the pixels of ${file}`);
}

let left = width;
let top = height;
let right = -1;
let bottom = -1;
let golden = 0;
for (let y = Math.round(height * TOP_MARGIN_FRACTION); y < height; y++) {
  for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4;
    if (isGolden(pixels[index] ?? 0, pixels[index + 1] ?? 0, pixels[index + 2] ?? 0)) {
      golden++;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
}

const boxWidth = right - left + 1;
const boxHeight = bottom - top + 1;
if (golden < 500 || boxWidth < width * MINIMUM_SIZE_FRACTION || boxHeight < width * MINIMUM_SIZE_FRACTION) {
  console.error(`No hologram found in ${file} (${golden} golden pixels, box ${boxWidth}x${boxHeight}).`);
  process.exit(1);
}

console.log(`${left} ${top} ${boxWidth} ${boxHeight}`);
