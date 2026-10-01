import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openPhotoSlot, PHOTO_SLOTS_PATH } from './photo-upload';

/**
 * The two requests the phone makes, held to the Jarvis server that answers them.
 *
 * Nothing compiles the two against each other: the server is another package, and the phone builds
 * its requests from an address typed into its settings. A path spelled differently on one side, or a
 * token the phone would refuse the shape of, builds, deploys, and then fails every photo — as "the
 * Jarvis server could not be reached", which is exactly what a phone with no network says. So the
 * server's routes and the way it mints a token are read out of its source, as
 * `take-photo.contract.spec.ts` reads the Kotlin.
 */

const REPOSITORY = join(import.meta.dir, '..', '..');

function readServerSource(...relativePath: string[]): string {
  return readFileSync(join(REPOSITORY, 'mcp', 'mastra', 'verticals', ...relativePath), 'utf8');
}

/** A route as `api/routes.ts` on the server declares it. */
function readRoute(name: string): string {
  const match = new RegExp(`export const ${name}\\s*=\\s*'([^']+)';`).exec(readServerSource('api', 'routes.ts'));

  expect(match, `routes.ts should declare ${name}`).not.toBeNull();
  return match?.[1] ?? '';
}

describe('the requests the phone makes, and the routes that answer them', () => {
  it('asks for a slot where the server opens them', () => {
    expect(readRoute('PHOTO_SLOTS_ROUTE')).toBe(PHOTO_SLOTS_PATH);
  });

  it('sends a photo to a path of the upload route’s shape, with a token as the server mints them', async () => {
    expect(readRoute('PHOTO_UPLOAD_ROUTE')).toBe('/api/photos/:uploadToken');

    // Sixteen random bytes, URL-safe: 22 characters from the alphabet the phone accepts a token in.
    expect(readServerSource('vision', 'photos.ts')).toContain("randomBytes(16).toString('base64url')");
    const minted = Buffer.from(new Uint8Array(16).fill(0xfb)).toString('base64url');
    const slot = await openPhotoSlot({
      serverAddress: 'https://jarvis.example.com',
      conversationId: 'conv_01jz8k3b4c5d6e7f',
      fetchImplementation: async () =>
        new Response(JSON.stringify({ success: true, data: { uploadPath: `/api/photos/${minted}` } }), {
          status: 201,
        }),
    });

    expect(slot).toEqual({ uploadPath: `/api/photos/${minted}` });
  });

  it('is answered by the slot route with the path the phone reads', () => {
    // The phone reads `data.uploadPath` from the server's envelope, and nothing else from it.
    expect(readRoute('PHOTO_UPLOAD_PATH')).toBe('/api/photos');
    expect(readServerSource('api', 'routes.ts')).toMatch(/uploadPath: `\$\{PHOTO_UPLOAD_PATH\}\/\$\{uploadToken\}`/);
  });
});
