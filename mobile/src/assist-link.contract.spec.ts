import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSIST_URL, createAssistLaunchClaim, isAssistLaunch } from './assist-link';

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

const ASSIST_LAUNCHER = 'modules/jarvis-assistant/android/src/main/java/expo/modules/jarvisassistant/AssistLauncher.kt';

/** The URL the voice interaction session actually launches. */
function readKotlinAssistUrl(): string {
  const source = readSource(ASSIST_LAUNCHER);
  const match = /ASSIST_URL\s*=\s*"([^"]+)"/.exec(source);

  expect(match, 'AssistLauncher.kt should declare an ASSIST_URL').not.toBeNull();
  return match?.[1] ?? '';
}

/** The name of the value the session puts on each summoning to tell it apart. */
function readKotlinSummonParameter(): string {
  const source = readSource(ASSIST_LAUNCHER);
  const match = /SUMMON_PARAMETER\s*=\s*"([^"]+)"/.exec(source);

  expect(match, 'AssistLauncher.kt should declare a SUMMON_PARAMETER').not.toBeNull();
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

  it('marks each summoning with a query value rather than a path segment', () => {
    // `summoningUri()` appends the marker to ASSIST_URL, and where it appends it
    // decides whether any of this works. As a query the path stays `assist`, so
    // `isAssistLaunch` still says yes; appended as a path segment the URL becomes
    // `heyjarvis://assist/<value>`, which it rejects — and then no summoning at
    // all would start listening. Everything else would still pass: the app opens,
    // in an assistant task, and sits there waiting to be asked a second time.
    expect(readSource(ASSIST_LAUNCHER)).toMatch(/appendQueryParameter\(\s*SUMMON_PARAMETER/);
  });

  it('launches a URL the app both recognises and can tell from the last one', () => {
    // The marker exists because the app is kept running between summonings, so
    // the second one arrives at a process that has already seen the first. Both
    // halves have to hold: each summoned URL is an assist launch, and two
    // summonings are two different launches rather than one seen twice.
    const parameter = readKotlinSummonParameter();
    const first = `${readKotlinAssistUrl()}?${parameter}=1000`;
    const second = `${readKotlinAssistUrl()}?${parameter}=2000`;

    expect(isAssistLaunch(first)).toBe(true);
    expect(isAssistLaunch(second)).toBe(true);

    const claim = createAssistLaunchClaim();
    expect(claim(first)).toBe(true);
    expect(claim(second)).toBe(true);
  });
});
