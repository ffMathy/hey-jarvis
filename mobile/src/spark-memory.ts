import { readStoredValue, writeStoredValue } from './key-value-store';

/** Where the number lives. Named for what it is so a future reader is not left guessing. */
const STORAGE_KEY = 'jarvis.sparks.proven';

/**
 * The most of Jarvis this phone has ever been seen drawing at a full frame rate, with his body
 * drawn by Skia.
 *
 * Skia's alone, because it is only ever read back to start Skia's body: the GPU's body starts at a
 * share of its own, and what it holds says nothing about what Skia's can. The hologram writes it
 * only while Skia draws the body (`keepsProvenShare`), so on a phone that draws on the GPU this is
 * what a fallback to Skia — a context late or lost — starts from.
 *
 * Written down so that the next summoning does not have to start from nothing. The loop that
 * measures it starts sparse and climbs — see `density-control.ts` — which takes a couple of
 * seconds, and those are the two seconds somebody is actually looking at him. Starting from *half*
 * of what he held yesterday skips most of them while asking today's phone for nothing it has not
 * already been seen to manage comfortably; see `REMEMBERED_SHARE` for why half and not all of it.
 *
 * It is a count the loop settled at, not one it passed through on the way up. That distinction is
 * the difference between a number this phone held and the last number it was given before it fell
 * over — see `proven` in `density-control.ts`.
 *
 * A share of the whole, 0–1, rather than a count: the number of particles is a thing the drawing
 * decides and has changed more than once, and a count written down under an old one would mean
 * something different when it was read back.
 *
 * Neither of these throws. A phone that cannot store it is a phone that measures it again, which
 * is exactly what happened before it was stored at all.
 */
export async function readProvenSparks(): Promise<number> {
  try {
    const stored = await readStoredValue(STORAGE_KEY);
    const share = stored === undefined ? Number.NaN : Number.parseFloat(stored);
    return Number.isFinite(share) && share > 0 && share <= 1 ? share : 0;
  } catch {
    return 0;
  }
}

export async function rememberProvenSparks(share: number): Promise<void> {
  if (!Number.isFinite(share) || share <= 0) {
    return;
  }
  try {
    await writeStoredValue(STORAGE_KEY, String(Math.min(1, share)));
  } catch {
    // Nothing to do and nothing worth saying: it will be measured again next time.
  }
}
