import { describe, expect, it, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The photo upload key as the phone asks for it, held to the server that checks it.
 *
 * Nothing compiles the two against each other: the server is another package, reading an
 * environment variable, and the phone is a settings field. The settings screen tells sir which
 * variable to copy the key from and refuses one shorter than the server takes; either drifting
 * builds, deploys and then turns every photo away with a 401 or a 503 — or refuses a key the server
 * would have taken. So both are read out of the server's source, as `take-photo.contract.spec.ts`
 * reads the Kotlin.
 *
 * The store is replaced before the module is loaded, because the real one cannot be imported
 * without React Native. See `photo-upload-key.spec.ts`.
 */
mock.module('./key-value-store', () => ({
  readStoredValue: async () => undefined,
  writeStoredValue: async () => undefined,
}));

const { MIN_PHOTO_UPLOAD_KEY_LENGTH, PHOTO_UPLOAD_KEY_VARIABLE } = await import('./photo-upload-key');

const REPOSITORY = join(import.meta.dir, '..', '..');

function readSource(...relativePath: string[]): string {
  return readFileSync(join(REPOSITORY, ...relativePath), 'utf8');
}

/** A constant as `upload-key.ts` on the server declares it. */
function readServerConstant(name: string): string {
  const match = new RegExp(`export const ${name}\\s*=\\s*'?([^';\\n]+)'?;`).exec(
    readSource('mcp', 'mastra', 'verticals', 'vision', 'upload-key.ts'),
  );

  expect(match, `upload-key.ts should declare ${name}`).not.toBeNull();
  return match?.[1] ?? '';
}

describe('the key the phone sends and the server checks', () => {
  it('is copied from the variable the server reads it from', () => {
    expect(readServerConstant('PHOTO_UPLOAD_KEY_VARIABLE')).toBe(PHOTO_UPLOAD_KEY_VARIABLE);
  });

  it('is named by that variable on the settings screen', () => {
    // Named through the constant, so the words sir reads are the ones the line above pins.
    expect(readSource('mobile', 'src', 'elevenlabs-fields.tsx')).toContain('{PHOTO_UPLOAD_KEY_VARIABLE}');
  });

  it('is refused below the length the server refuses it below', () => {
    expect(Number(readServerConstant('MIN_PHOTO_UPLOAD_KEY_LENGTH'))).toBe(MIN_PHOTO_UPLOAD_KEY_LENGTH);
  });
});
