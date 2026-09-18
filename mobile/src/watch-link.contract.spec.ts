import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Everything the phone and the watch agree on by spelling the same string twice, in two languages
 * and on two devices — and every one of them is silent when it breaks.
 *
 * Three agreements, all of the same shape. **The capability**, which is how the phone knows Jarvis
 * is on the watch at all: it cannot ask a watch what it has installed, so it asks the Data Layer
 * which devices advertise a name, and the watch advertises one from a resource its config plugin
 * writes. **The settings path**, which carries the ElevenLabs credentials from the phone to the
 * watch so they are only ever typed on a keyboard worth typing them on. **The asking path**, which
 * carries the watch's request for them back the other way.
 *
 * Nothing fails loudly if any of them drift. Both apps build, both install, both run — and the
 * phone says Jarvis is not on the watch however many times it is installed, or the watch waits for
 * ever for a message the phone is sending to an address nobody is listening at.
 *
 * All of them are read out of their sources rather than imported. Importing the modules would pull
 * in `expo` and so `react-native`, whose Flow types `bun test` cannot parse — the same reason
 * `assist-link.contract.spec.ts` reads the Kotlin as text.
 */

const REPOSITORY = join(import.meta.dir, '../..');

function readSource(relativePath: string): string {
  return readFileSync(join(REPOSITORY, relativePath), 'utf8');
}

const PHONE_MODULE = 'mobile/modules/jarvis-watch/android/src/main/java/expo/modules/jarviswatch/JarvisWatchModule.kt';
const PHONE_TYPESCRIPT = 'mobile/modules/jarvis-watch/index.ts';
const WATCH_MODULE = 'watch/modules/jarvis-phone/android/src/main/java/expo/modules/jarvisphone/JarvisPhoneModule.kt';
const WATCH_TYPESCRIPT = 'watch/modules/jarvis-phone/index.ts';
const WATCH_MANIFEST = 'watch/modules/jarvis-phone/android/src/main/AndroidManifest.xml';

/** One `const NAME = "value"` out of a Kotlin source, however it is qualified. */
function readKotlinConstant(source: string, name: string): string {
  const match = new RegExp(`${name}\\s*=\\s*"([^"]+)"`).exec(readSource(source));

  expect(match, `${source} should declare ${name}`).not.toBeNull();
  return match?.[1] ?? '';
}

/** The capability the phone looks for. */
function readKotlinCapability(): string {
  return readKotlinConstant(PHONE_MODULE, 'JARVIS_ON_THE_WATCH');
}

/** The capability the watch advertises, out of the resource its config plugin writes. */
function readWatchCapability(): string {
  const match = /<item>([^<]+)<\/item>/.exec(readSource('watch/app.config.ts'));

  expect(match, "wear/app.config.ts should write a capability into wear.xml's item").not.toBeNull();
  return match?.[1] ?? '';
}

/** And the name the JavaScript side hands back to anything that wants to say it out loud. */
function readTypeScriptCapability(): string {
  const match = /JARVIS_ON_THE_WATCH\s*=\s*'([^']+)'/.exec(readSource(PHONE_TYPESCRIPT));

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
    const source = readSource('watch/app.config.ts');

    // The name and the shape are both conventions of Google Play Services rather than anything
    // Expo or Android checks, so a typo in either is silent.
    expect(source).toContain("'wear.xml'");
    expect(source).toMatch(/<string-array name="android_wear_capabilities">/);
    expect(source).toMatch(/res\/values/);
  });
});

describe('the paths the ElevenLabs credentials travel between the two apps', () => {
  it('spells the settings path the same on the phone and on the watch', () => {
    // What the phone sends the credentials on, and what the watch listens for. A mismatch is a
    // watch that waits for ever while the phone reports a successful send, because Play Services
    // accepts a message for a path nothing is listening on and then drops it.
    const wanted = readKotlinConstant(PHONE_MODULE, 'SETTINGS_PATH');

    expect(wanted).toMatch(/^\/jarvis\//);
    expect(readKotlinConstant(WATCH_MODULE, 'SETTINGS_PATH')).toBe(wanted);
  });

  it('spells the asking path the same in both directions', () => {
    const wanted = readKotlinConstant(PHONE_MODULE, 'ASK_PATH');

    expect(wanted).toMatch(/^\/jarvis\//);
    expect(readKotlinConstant(WATCH_MODULE, 'ASK_PATH')).toBe(wanted);
  });

  it('claims the settings path in the manifest that wakes the watch for it', () => {
    // The one copy that is neither Kotlin nor TypeScript. Play Services only starts the listener
    // service for paths the manifest claims, so a path that drifts from here means the handover
    // works while the watch app happens to be open and silently does not when it is not — which
    // is the case the button on the phone exists for.
    expect(readSource(WATCH_MANIFEST)).toContain(readKotlinConstant(WATCH_MODULE, 'SETTINGS_PATH'));
    expect(readSource(WATCH_MANIFEST)).toContain('com.google.android.gms.wearable.MESSAGE_RECEIVED');
  });

  it('names the same event on both sides of each app', () => {
    // Kotlin emits it and TypeScript subscribes by name, with nothing checking the two agree.
    expect(readSource(PHONE_TYPESCRIPT)).toContain(readKotlinConstant(PHONE_MODULE, 'WATCH_ASKED'));
    expect(readSource(WATCH_TYPESCRIPT)).toContain(readKotlinConstant(WATCH_MODULE, 'SETTINGS_ARRIVED'));
  });

  it('sends the two credentials under the names the watch reads back', () => {
    // The payload is JSON built in one Kotlin file and parsed in another, on the other device.
    for (const field of ['apiKey', 'agentId']) {
      expect(readSource(PHONE_MODULE)).toContain(`"${field}"`);
      expect(
        readSource('watch/modules/jarvis-phone/android/src/main/java/expo/modules/jarvisphone/PhoneSettingsStore.kt'),
      ).toContain(`"${field}"`);
    }
  });
});
