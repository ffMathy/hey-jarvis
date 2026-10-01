import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PHOTO_LONG_EDGE, PHOTO_QUALITY } from './photo-upload';
import { PICKER_GIVE_UP_AFTER_MS } from './take-photo.web';

/**
 * The photo's way through Kotlin, held to what the rest of the app assumes of it.
 *
 * Nothing compiles these against each other. The file provider's authority and directory are
 * spelled in the manifest, the paths resource and the activity; the module's function names in
 * Kotlin and in `index.ts`; the photo's size and quality in Kotlin and in the browser's half. Any of
 * them drifting builds, installs, and then fails on every photo — as "no photo taken", which is
 * the one failure that looks like sir changing his mind. The answer for a photo taken that could not
 * be made ready is spelled in Kotlin and in `index.ts` too: drifted, it would reach JavaScript as a
 * URI to fetch, and be told apart from a photo only by that fetch happening to fail. How long the
 * camera may stay open is spelled in Kotlin and in the browser's half as well, so that a phone and a
 * browser give up on it alike.
 *
 * And one thing has to stay *absent*: the CAMERA permission. The phone's camera app takes the photo,
 * which needs no permission from an app that does not declare it, and throws for one that declares
 * it without holding it.
 */

const MOBILE_ROOT = join(import.meta.dir, '..');
const MODULE = 'modules/jarvis-assistant';
const KOTLIN = `${MODULE}/android/src/main/java/expo/modules/jarvisassistant`;

function readSource(relativePath: string): string {
  return readFileSync(join(MOBILE_ROOT, relativePath), 'utf8');
}

/** A constant as `JarvisPhotoActivity` declares it. */
function readPhotoConstant(name: string): string {
  const match = new RegExp(`${name}\\s*=\\s*"?([^"\\n]+?)"?L?\\s*$`, 'm').exec(
    readSource(`${KOTLIN}/JarvisPhotoActivity.kt`),
  );

  expect(match, `JarvisPhotoActivity.kt should declare ${name}`).not.toBeNull();
  return match?.[1] ?? '';
}

describe('taking a photo without holding the camera permission', () => {
  it('keeps CAMERA blocked, so the camera app needs no permission from Jarvis', () => {
    expect(readSource('app.config.ts')).toMatch(/blockedPermissions:\s*\[[^\]]*'android\.permission\.CAMERA'/);
  });

  it('never asks for it either', () => {
    const permissions = /permissions:\s*\[([^\]]*)\]/.exec(readSource('app.config.ts'))?.[1] ?? '';

    expect(permissions).not.toContain('CAMERA');
  });
});

describe('the file the camera app writes the photo into', () => {
  const manifest = readSource(`${MODULE}/android/src/main/AndroidManifest.xml`);

  it('is lent by the provider the activity asks for', () => {
    expect(manifest).toContain(`android:authorities="\${applicationId}${readPhotoConstant('PROVIDER_SUFFIX')}"`);
    expect(manifest).toContain('android:name="expo.modules.jarvisassistant.JarvisPhotoProvider"');
  });

  it('is in the one directory the provider will lend from', () => {
    const paths = readSource(`${MODULE}/android/src/main/res/xml/jarvis_photo_paths.xml`);
    const directory = /File\(context\.cacheDir, "([^"]+)"\)/.exec(readSource(`${KOTLIN}/JarvisPhotoActivity.kt`))?.[1];

    expect(directory).toBeDefined();
    expect(paths).toContain(`<cache-path name="photos" path="${directory}/" />`);
  });

  it('is written by an activity in a task of its own, which no app can start', () => {
    const activity = /<activity\s+android:name="expo\.modules\.jarvisassistant\.JarvisPhotoActivity"[^>]*>/.exec(
      manifest,
    )?.[0];

    expect(activity).toContain('android:exported="false"');
    expect(activity).toContain('android:taskAffinity=""');
  });
});

describe('the module the screen calls', () => {
  it('offers the functions the JavaScript side calls, under the same names', () => {
    const kotlin = readSource(`${KOTLIN}/JarvisAssistantModule.kt`);
    const javascript = readSource(`${MODULE}/index.ts`);

    for (const name of ['takePhoto', 'returnFromTheCamera']) {
      expect(kotlin).toContain(`AsyncFunction("${name}")`);
      expect(javascript).toMatch(new RegExp(`\\b${name}\\(`));
    }
  });
});

describe('a photo taken that could not be made ready to send', () => {
  const kotlin = readSource(`${KOTLIN}/JarvisPhotoActivity.kt`);

  it('is answered as such, rather than as no photo, when the activity cannot make it ready', () => {
    expect(kotlin).toContain('deliver(request, NOT_READABLE)');
  });

  it('is answered with the word the JavaScript side reads it by', () => {
    const javascript = /const NOT_READABLE = '([^']+)'/.exec(readSource(`${MODULE}/index.ts`))?.[1];

    expect(javascript).toBeDefined();
    expect(readPhotoConstant('NOT_READABLE')).toBe(javascript ?? '');
    // Never a photo's URI, which is what every other answer but none is.
    expect(javascript).not.toStartWith('file://');
  });
});

describe('the photo as it is sent', () => {
  it('is the same size and quality from the camera app as from a browser', () => {
    expect(Number(readPhotoConstant('LONG_EDGE'))).toBe(PHOTO_LONG_EDGE);
    expect(Number(readPhotoConstant('JPEG_QUALITY'))).toBe(Math.round(PHOTO_QUALITY * 100));
  });
});

describe('a camera left open', () => {
  it('is given up on after as long in a browser as the camera app is on the phone', () => {
    expect(Number(readPhotoConstant('GIVE_UP_AFTER_MS').replaceAll('_', ''))).toBe(PICKER_GIVE_UP_AFTER_MS);
  });
});
