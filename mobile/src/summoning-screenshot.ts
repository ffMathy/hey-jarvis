import { screenshotOfThisSummoning } from '../modules/jarvis-assistant';
import type { ReadSummoningScreenshot } from './platform-contracts';

/**
 * Reads what was on the screen when sir summoned Jarvis, as a `Blob` to send.
 *
 * The native half keeps the screenshot the system handed the assistant's window, small, as a JPEG in
 * the app's cache (`SummoningScreenshot.kt`); reading it through `fetch` is how React Native turns a
 * `file://` URI into a `Blob`, as `take-photo.ts` does with a photo. One that cannot be read back is
 * none: nobody is waiting on it.
 */
export const readSummoningScreenshot: ReadSummoningScreenshot = async () => {
  const uri = await screenshotOfThisSummoning();
  if (uri === undefined) {
    return undefined;
  }
  try {
    const read = await fetch(uri);
    return await read.blob();
  } catch {
    return undefined;
  }
};
