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
 * The PNG is decoded by ffmpeg, which the emulator check already needs for its
 * recording, rather than by a decoder of this package's own: ffprobe gives the
 * size, and ffmpeg writes the pixels out as plain RGBA.
 *
 * Usage: bun find-hologram.ts <screenshot PNG>
 */
import { spawnSync } from 'bun';

/** Ignore the status bar, whose icons can be any colour. */
const TOP_MARGIN_FRACTION = 0.06;
/** A region this much smaller than the screen width is not the hologram. */
const MINIMUM_SIZE_FRACTION = 0.3;

/** Runs a tool to the end and hands back what it wrote, or throws with what it said went wrong. */
function outputOf(command: string[]): Uint8Array {
  const run = spawnSync(command, { stdout: 'pipe', stderr: 'pipe' });
  if (!run.success) {
    throw new Error(`${command[0]} failed: ${run.stderr.toString().trim()}`);
  }
  return run.stdout;
}

/** The screenshot's size, from ffprobe, as `width,height`. */
function sizeOf(png: string): { width: number; height: number } {
  const size = new TextDecoder()
    .decode(
      outputOf([
        'ffprobe',
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height',
        '-of',
        'csv=p=0',
        png,
      ]),
    )
    .trim();
  const [width, height] = size.split(',').map(Number);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width === undefined || height === undefined) {
    throw new Error(`${png} is not an image (ffprobe read its size as "${size}")`);
  }
  return { width, height };
}

/** Amber and gold: red strong, blue well below it, green in between. */
function isGolden(red: number, green: number, blue: number): boolean {
  return red > 110 && green > 60 && red > blue * 1.6 && green > blue * 1.2;
}

const [file] = process.argv.slice(2);
if (!file) {
  throw new Error('Usage: bun find-hologram.ts <screenshot PNG>');
}

const { width, height } = sizeOf(file);
const pixels = outputOf(['ffmpeg', '-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
if (pixels.length !== width * height * 4) {
  throw new Error(`Could not read the pixels of ${file}: ${pixels.length} bytes for ${width}x${height}`);
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
