import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PictureMoment } from '../../src/preview/preview-hook';

/**
 * The moments his picture is held to (`hologram-picture.spec.ts`), and where their goldens are:
 * `fixtures/picture/moments.json` names each moment and the size it is drawn at, and
 * `fixtures/picture/<name>.png` is how the GPU picture drew it when the goldens were last drawn
 * (`.scripts/render-picture-goldens.ts`).
 */

export const PICTURE_FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'picture');

/** A moment of `moments.json`: a frame, maybe satellites, and the name its golden is kept under. */
export type NamedMoment = PictureMoment & { name: string };

export interface PictureMoments {
  size: number;
  moments: NamedMoment[];
}

function isPictureMoments(value: unknown): value is PictureMoments {
  return (
    typeof value === 'object' &&
    value !== null &&
    'size' in value &&
    typeof value.size === 'number' &&
    'moments' in value &&
    Array.isArray(value.moments)
  );
}

export function readPictureMoments(): PictureMoments {
  const parsed: unknown = JSON.parse(readFileSync(path.join(PICTURE_FIXTURES, 'moments.json'), 'utf8'));
  if (!isPictureMoments(parsed)) throw new Error('moments.json is not a size and a list of moments.');
  return parsed;
}

/** Where the golden of the moment called `name` is kept. */
export function goldenPath(name: string): string {
  return path.join(PICTURE_FIXTURES, `${name}.png`);
}
