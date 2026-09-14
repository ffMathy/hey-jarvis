import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSIST_URL, isAssistLaunch } from './assist-link';

/**
 * The handover from the Kotlin side to the JavaScript side.
 *
 * When the user summons Jarvis, the voice interaction session builds a URL in
 * Kotlin and the app reads it back in TypeScript. The two halves cannot share a
 * constant, and a third copy — the `scheme` in `app.config.ts` — is what makes
 * Android route the URL to the app at all.
 *
 * If those three drift apart, nothing fails loudly. The build succeeds, the app
 * installs, the assistant registration is still valid, and the gesture opens
 * either nothing or an app that sits there waiting to be asked a second time.
 * It is exactly the kind of break a device would catch and no other test here
 * can, so the agreement is asserted from the sources themselves rather than
 * left to the comments that point at each other.
 */

const MOBILE_ROOT = join(import.meta.dir, '..');

function readSource(relativePath: string): string {
  return readFileSync(join(MOBILE_ROOT, relativePath), 'utf8');
}

/** The `scheme` Expo puts in the manifest, which is what makes the URL reach the app. */
function readConfiguredScheme(): string {
  const source = readSource('app.config.ts');
  const match = /scheme:\s*'([^']+)'/.exec(source);

  expect(match, 'app.config.ts should declare a scheme').not.toBeNull();
  return match?.[1] ?? '';
}

/** The URL the voice interaction session actually launches. */
function readKotlinAssistUrl(): string {
  const source = readSource(
    'modules/jarvis-assistant/android/src/main/java/expo/modules/jarvisassistant/AssistLauncher.kt',
  );
  const match = /ASSIST_URL\s*=\s*"([^"]+)"/.exec(source);

  expect(match, 'AssistLauncher.kt should declare an ASSIST_URL').not.toBeNull();
  return match?.[1] ?? '';
}

describe('the assist handover between Kotlin and TypeScript', () => {
  it('launches the exact URL the app watches for', () => {
    expect(readKotlinAssistUrl()).toBe(ASSIST_URL);
  });

  it('launches a URL the app recognises as an assist launch', () => {
    // The assertion that matters most: whatever Kotlin sends has to make
    // `isAssistLaunch` say yes, or the conversation never starts on its own.
    expect(isAssistLaunch(readKotlinAssistUrl())).toBe(true);
  });

  it('uses the scheme Expo registers for the app', () => {
    const scheme = readConfiguredScheme();

    expect(readKotlinAssistUrl().startsWith(`${scheme}://`)).toBe(true);
    expect(ASSIST_URL.startsWith(`${scheme}://`)).toBe(true);
  });
});
