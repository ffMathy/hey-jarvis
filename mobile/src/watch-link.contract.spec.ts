import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The third handover written in two languages, and the quietest when it breaks.
 *
 * The phone cannot ask a watch what it has installed. It asks the Wearable Data Layer which
 * devices advertise a named capability, and the watch app advertises one — the name is spelled in
 * Kotlin on the phone, in TypeScript beside it, and again in the resource the watch's config
 * plugin writes. Three copies, no compiler between them.
 *
 * Nothing fails if they drift. Both apps build, both install, the watch runs — and the phone's
 * settings screen says Jarvis is not on the watch, for ever, however many times it is installed.
 *
 * All three are read out of their sources rather than imported. Importing the module would pull in
 * `expo` and so `react-native`, whose Flow types `bun test` cannot parse — the same reason
 * `assist-link.contract.spec.ts` reads the Kotlin as text.
 */

const REPOSITORY = join(import.meta.dir, '../..');

function readSource(relativePath: string): string {
  return readFileSync(join(REPOSITORY, relativePath), 'utf8');
}

const MODULE = 'mobile/modules/jarvis-watch/android/src/main/java/expo/modules/jarviswatch/JarvisWatchModule.kt';

/** The capability the phone looks for. */
function readKotlinCapability(): string {
  const match = /JARVIS_ON_THE_WATCH\s*=\s*"([^"]+)"/.exec(readSource(MODULE));

  expect(match, 'JarvisWatchModule.kt should declare a capability name').not.toBeNull();
  return match?.[1] ?? '';
}

/** The capability the watch advertises, out of the resource its config plugin writes. */
function readWatchCapability(): string {
  const match = /<item>([^<]+)<\/item>/.exec(readSource('wear/app.config.ts'));

  expect(match, "wear/app.config.ts should write a capability into wear.xml's item").not.toBeNull();
  return match?.[1] ?? '';
}

/** And the name the JavaScript side hands back to anything that wants to say it out loud. */
function readTypeScriptCapability(): string {
  const match = /JARVIS_ON_THE_WATCH\s*=\s*'([^']+)'/.exec(readSource('mobile/modules/jarvis-watch/index.ts'));

  expect(match, 'jarvis-watch/index.ts should export a capability name').not.toBeNull();
  return match?.[1] ?? '';
}

describe('the capability the phone finds the watch app by', () => {
  it('is spelled the same in the phone module, in TypeScript beside it, and on the watch', () => {
    const wanted = readTypeScriptCapability();

    expect(wanted).not.toBe('');
    expect(readKotlinCapability()).toBe(wanted);
    expect(readWatchCapability()).toBe(wanted);
  });

  it('is written into the file Play Services actually reads', () => {
    const source = readSource('wear/app.config.ts');

    // The name and the shape are both conventions of Google Play Services rather than anything
    // Expo or Android checks, so a typo in either is silent.
    expect(source).toContain("'wear.xml'");
    expect(source).toMatch(/<string-array name="android_wear_capabilities">/);
    expect(source).toMatch(/res\/values/);
  });
});
