import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAIRED_LINK, PHONE_PAIRING_PATH, pairedTokenFromLink } from './jarvis-server';

/**
 * The phone's pairing, held to the server's pairing page and to this app's own scheme.
 *
 * Nothing compiles the three against each other: the page is another package's route, it sends the
 * browser on to a link it spells itself, and the link only reaches this app if Android knows the
 * scheme from `app.config.ts`. A spelling that drifts on any side builds, installs, and then leaves
 * sir signed in to a page whose button opens nothing, or opens the app with a token it never reads.
 * So all three are read out of their sources, as `photo-upload.contract.spec.ts` reads the routes.
 */

const REPOSITORY = join(import.meta.dir, '..', '..');

function readSource(...relativePath: string[]): string {
  return readFileSync(join(REPOSITORY, ...relativePath), 'utf8');
}

const PAIRED_DEVICES = readSource('mcp', 'mastra', 'verticals', 'api', 'paired-devices.ts');

/** A constant as `paired-devices.ts` on the server declares it. */
function readServerConstant(name: string): string {
  const match = new RegExp(`export const ${name}\\s*=\\s*'([^']+)';`).exec(PAIRED_DEVICES);
  expect(match, `paired-devices.ts should declare ${name}`).not.toBeNull();
  return match?.[1] ?? '';
}

describe('pairing the phone, between the app and the server', () => {
  it('opens the page the server serves for it', () => {
    expect(readServerConstant('PHONE_PAIRING_ROUTE')).toBe(PHONE_PAIRING_PATH);
  });

  it('listens for the link the page sends the browser on to', () => {
    expect(readServerConstant('PHONE_APP_PAIRED_URL')).toBe(PAIRED_LINK);
  });

  it('reads the token as the server writes it into that link', () => {
    // The redirect puts the token after a `#`, written by `URLSearchParams` under the name `token`.
    expect(PAIRED_DEVICES).toMatch(/PHONE_APP_PAIRED_URL\}#\$\{new URLSearchParams\(\{ token \}\)\}/);
    const token = 'Q2hhbmdlIG1lIHBsZWFzZSwgcGxlYXNlIHNpcg_-';
    expect(pairedTokenFromLink(`${PAIRED_LINK}#${new URLSearchParams({ token })}`)).toBe(token);
  });

  it('is a link of the scheme Android opens this app for', () => {
    const scheme = /scheme:\s*'([^']+)'/.exec(readSource('mobile', 'app.config.ts'))?.[1];
    expect(scheme).toBeDefined();
    expect(PAIRED_LINK.startsWith(`${scheme}://`)).toBe(true);
  });
});
