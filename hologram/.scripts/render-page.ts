/**
 * The headless Chromium every offline render draws Jarvis in, and the page it draws him on.
 *
 * He is drawn only on the GPU (`hologram/gpu`), so a render needs a WebGL 2 context, and Bun has
 * none: the drawing half of each script is a page entry (`render-*-page.ts`) bundled here and run
 * in Chromium, while the script itself keeps the clock, the simulated voice, the files and ffmpeg.
 * SwiftShader stands in for a GPU, so a machine without one renders the same picture, only slower.
 *
 * The page is served from a made-up origin, so the entry can `fetch` the device art and load the
 * font by URL as a page would, with every request answered from `device-art/` and nothing reaching
 * the network.
 *
 * CHROMIUM_EXECUTABLE_PATH picks the browser, as it does for the browser tests.
 */
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { type Browser, chromium, type Page } from '@playwright/test';

/** Where the page pretends to live; nothing is ever fetched from it but what is routed below. */
export const RENDER_ORIGIN = 'https://jarvis-render.invalid';

/** Where the fetched artwork lives, which the page asks for as `${RENDER_ORIGIN}/<file>`. See `device-art/NOTICE.md`. */
const DEVICE_ART = join(import.meta.dir, 'device-art');

/**
 * SwiftShader, Chromium's own software GPU, on purpose rather than as a fallback: headless Chromium
 * on a machine without a GPU otherwise refuses WebGL altogether, and with a GPU it would draw the
 * same picture anyway.
 */
const LAUNCH_ARGUMENTS = ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'];

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
};

/** A page with one entry's drawing in it, and the browser it is in. */
export interface RenderPage {
  page: Page;
  close: () => Promise<void>;
}

/** `entry` (a file beside this one) and everything it imports, as one classic script for the page. */
async function bundle(entry: string): Promise<string> {
  const built = await Bun.build({
    entrypoints: [join(import.meta.dir, entry)],
    target: 'browser',
    format: 'iife',
  });
  const [output] = built.outputs;
  if (!built.success || output === undefined) {
    throw new Error(`Could not bundle ${entry}: ${built.logs.join('\n')}`);
  }
  return output.text();
}

/**
 * Opens a page with `entry` running in it, ready to be driven with `page.evaluate`.
 *
 * Anything the page throws or logs as an error is rethrown from the next `evaluate` by Playwright
 * or printed here, so a shader that fails to compile says why rather than leaving a black frame.
 */
export async function openRenderPage(entry: string): Promise<RenderPage> {
  const script = await bundle(entry);
  const browser: Browser = await chromium.launch({
    args: LAUNCH_ARGUMENTS,
    // Normally undefined, meaning the browser Playwright installed for itself. It exists for
    // machines that have a Chromium but not that exact build, as for the browser tests.
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (error) => console.error(`page: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') {
        console.error(`page: ${message.text()}`);
      }
    });
    await page.route(`${RENDER_ORIGIN}/**`, (route) => {
      const file = new URL(route.request().url()).pathname.slice(1);
      if (file === '') {
        return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body></body>' });
      }
      const contentType = CONTENT_TYPES[extname(file)];
      if (contentType === undefined || file.includes('/')) {
        return route.fulfill({ status: 404 });
      }
      return route.fulfill({ contentType, body: readFileSync(join(DEVICE_ART, file)) });
    });
    await page.goto(`${RENDER_ORIGIN}/`);
    await page.addScriptTag({ content: script });
    return { page, close: () => browser.close() };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

/** The bytes of a file the page encoded and handed back as base64, which is all `evaluate` can return. */
export function bytesOf(base64: string): Uint8Array {
  return Buffer.from(base64, 'base64');
}
