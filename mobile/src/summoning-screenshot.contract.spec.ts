import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PHOTO_LONG_EDGE, PHOTO_QUALITY } from './photo-upload';

/**
 * The screenshot's way through Kotlin, held to what the rest of the app assumes of it.
 *
 * Nothing compiles these against each other, and every one of them failing looks the same: a
 * summoning with no screenshot, which is also what a phone with "Use screenshot" switched off sends.
 * The module's function is spelled in Kotlin and in `index.ts`; the session has to take the system's
 * screenshot under the method's real name, or it is a method nothing calls; and the window coming
 * back after the camera has to say so, or it counts as a new summoning and forgets the screen the
 * conversation in it was summoned over. Read as text, as `take-photo.contract.spec.ts` reads the photo's.
 */

const MOBILE_ROOT = join(import.meta.dir, '..');
const MODULE = 'modules/jarvis-assistant';
const KOTLIN = `${MODULE}/android/src/main/java/expo/modules/jarvisassistant`;

function readSource(relativePath: string): string {
  return readFileSync(join(MOBILE_ROOT, relativePath), 'utf8');
}

/** A constant as `SummoningScreenshot` declares it. */
function readScreenshotConstant(name: string): number {
  const match = new RegExp(`${name}\\s*=\\s*([\\d_]+)L?\\s*$`, 'm').exec(
    readSource(`${KOTLIN}/SummoningScreenshot.kt`),
  );

  expect(match, `SummoningScreenshot.kt should declare ${name}`).not.toBeNull();
  return Number(match?.[1]?.replaceAll('_', ''));
}

describe('the screenshot the system takes when sir summons Jarvis', () => {
  const session = readSource(`${KOTLIN}/JarvisVoiceInteractionSession.kt`);

  it('is taken by the session, under the name the system calls', () => {
    expect(session).toContain('override fun onHandleScreenshot(screenshot: Bitmap?)');
    expect(session).toContain('SummoningScreenshot.arrived(context, screenshot)');
  });

  it('is expected only when the showing asks the system for one', () => {
    expect(session).toContain('SummoningScreenshot.summoned(context, showFlags and SHOW_WITH_SCREENSHOT != 0)');
  });

  it('is kept when the window comes back after the camera, which is the same summoning', () => {
    expect(session).toContain('args?.getBoolean(BACK_FROM_THE_CAMERA) != true');
    expect(session).toContain('JarvisVoiceInteractionService.summon(backFromTheCamera = true)');
    expect(readSource(`${KOTLIN}/JarvisVoiceInteractionService.kt`)).toContain(
      'putBoolean(JarvisVoiceInteractionSession.BACK_FROM_THE_CAMERA, backFromTheCamera)',
    );
  });

  it('is handed to JavaScript under the name it asks for', () => {
    expect(readSource(`${KOTLIN}/JarvisAssistantModule.kt`)).toContain('AsyncFunction("screenshotOfThisSummoning")');
    expect(readSource(`${MODULE}/index.ts`)).toMatch(/\bnativeModule\?\.screenshotOfThisSummoning\(\)/);
  });

  it('is sent at the size and quality a photo is', () => {
    expect(readScreenshotConstant('LONG_EDGE')).toBe(PHOTO_LONG_EDGE);
    expect(readScreenshotConstant('JPEG_QUALITY')).toBe(Math.round(PHOTO_QUALITY * 100));
  });

  it('passes through a directory of its own, which the photo activity does not clear', () => {
    const screenshots = /File\(context\.cacheDir, "([^"]+)"\)/.exec(
      readSource(`${KOTLIN}/SummoningScreenshot.kt`),
    )?.[1];
    const photos = /File\(context\.cacheDir, "([^"]+)"\)/.exec(readSource(`${KOTLIN}/JarvisPhotoActivity.kt`))?.[1];

    expect(screenshots).toBeDefined();
    expect(screenshots).not.toBe(photos);
  });
});
