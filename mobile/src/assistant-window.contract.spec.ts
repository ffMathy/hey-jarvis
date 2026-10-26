import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSISTANT_SURFACE, SHOWING_PROP } from './assistant-window';

/**
 * The other handover between the Kotlin side and the JavaScript side.
 *
 * Summoned, the app is not launched: the voice interaction session starts a React Native surface
 * by name, in the window the system draws over whatever was already on screen. The name is written
 * twice — once in Kotlin, where the surface is started, and once in `index.ts`, where the app
 * answers to it — and nothing checks that they agree.
 *
 * Nothing would fail loudly if they did not. The build succeeds, the app installs, the assistant
 * registration stays valid, and the gesture opens a window with nothing in it.
 */

const MOBILE_ROOT = join(import.meta.dir, '..');

function readSource(relativePath: string): string {
  return readFileSync(join(MOBILE_ROOT, relativePath), 'utf8');
}

const SESSION =
  'modules/jarvis-assistant/android/src/main/java/expo/modules/jarvisassistant/JarvisVoiceInteractionSession.kt';

const MODULE = 'modules/jarvis-assistant/android/src/main/java/expo/modules/jarvisassistant/JarvisAssistantModule.kt';

/** A string constant as the session — or another Kotlin file — declares it. */
function readKotlinConstant(name: string, file = SESSION): string {
  const source = readSource(file);
  const match = new RegExp(`${name}\\s*=\\s*"([^"]+)"`).exec(source);

  expect(match, `${file} should declare ${name}`).not.toBeNull();
  return match?.[1] ?? '';
}

describe('the assistant window handover between Kotlin and TypeScript', () => {
  it('starts the surface the app registers itself as', () => {
    expect(readKotlinConstant('MAIN_COMPONENT')).toBe(ASSISTANT_SURFACE);
  });

  it('registers that surface, and it is not the one the launcher opens', () => {
    const entry = readSource('index.ts');

    // Registered at all — without this the name resolves to nothing and the window is empty.
    expect(entry).toMatch(/AppRegistry\.registerComponent\(ASSISTANT_SURFACE/);
    // And a different component from the launched one, because the only difference between the
    // two is that this one knows it was summoned. Registering `main` here instead would leave the
    // summoned app waiting to be asked a second time.
    expect(ASSISTANT_SURFACE).not.toBe('main');
    expect(entry).toMatch(/createElement\(App,\s*\{\s*summoned:\s*true\b/);
  });

  // Drift here fails quietly too: the app never hears that its window was shown again, so once a
  // conversation has ended every later summoning opens an empty window — the sheet stays off the
  // bottom of the screen and nothing starts.
  it('announces each showing under the prop the summoned root reads', () => {
    expect(readKotlinConstant('SHOWING_PROP')).toBe(SHOWING_PROP);

    const entry = readSource('index.ts');
    expect(entry).toMatch(/showing:\s*props\[SHOWING_PROP\]/);
  });

  // Drift here fails quietly as well, and audibly: the window is put away — the screen timing out
  // over the lock screen does it — and he goes on listening and answering with nothing on screen.
  it('tells the app its window was put away under the event the app listens for', () => {
    // Read rather than imported: the module's `index.ts` imports `expo`, which bun cannot load.
    const javascript = /export const WINDOW_PUT_AWAY = '([^']+)'/.exec(
      readSource('modules/jarvis-assistant/index.ts'),
    )?.[1];

    expect(javascript, 'index.ts should declare WINDOW_PUT_AWAY').toBeDefined();
    expect(readKotlinConstant('WINDOW_PUT_AWAY', MODULE)).toBe(javascript ?? '');
  });
});

const UNLOCK = 'modules/jarvis-assistant/android/src/main/java/expo/modules/jarvisassistant/JarvisUnlockActivity.kt';

const WATCH_SUMMON =
  'modules/jarvis-assistant/android/src/main/java/expo/modules/jarvisassistant/JarvisWatchSummonService.kt';

/** The body of one Kotlin function, from its signature to the next declaration at the same depth. */
function readKotlinFunction(file: string, signature: string): string {
  const source = readSource(file);
  const start = source.indexOf(signature);
  expect(start, `${file} should declare ${signature}`).toBeGreaterThanOrEqual(0);
  const next = source.slice(start + signature.length).search(/\n {2}(?:override |private |internal )?fun /);
  return next < 0 ? source.slice(start) : source.slice(start, start + signature.length + next);
}

// Summoned on a locked phone, the window used to draw the app and start a conversation behind the
// lock screen: the greeting played and nothing else could be seen, and a conversation that went on
// would have been anybody's who held the phone. Nothing about that fails a build.
describe('a summoning on a locked phone', () => {
  it('asks for the phone to be unlocked before anything is shown or started', () => {
    const onShow = readKotlinFunction(SESSION, 'override fun onShow(');
    const locked = onShow.indexOf('if (isLocked())');

    expect(locked, 'onShow should check for the lock screen').toBeGreaterThanOrEqual(0);
    const lockedBranch = onShow.slice(locked, onShow.indexOf('return', locked));
    // The unlock prompt is started before the session is retracted, which would make the start illegal.
    expect(lockedBranch).toMatch(/askToUnlock\(\)[\s\S]*hide\(\)/);
    // Nothing that starts a conversation, or keeps a screenshot of the lock screen, comes first.
    for (const starts of ['announceShowing', 'showFlags and SHOW_WITH_SCREENSHOT', 'nextShowing']) {
      const at = onShow.indexOf(starts);
      if (at >= 0) {
        expect(at, `${starts} should come after the lock screen is dealt with`).toBeGreaterThan(locked);
      }
    }
  });

  it('does not draw the app, which starts a conversation as it mounts, into a window made while locked', () => {
    const onCreateContentView = readKotlinFunction(SESSION, 'override fun onCreateContentView(');

    expect(onCreateContentView).toMatch(/if \(!isLocked\(\)\) \{\s*drawAppInto\(/);
    expect(onCreateContentView).not.toMatch(/createSurface/);
  });

  it('judges any lock screen as locked, the same way on the phone and for the watch', () => {
    expect(readKotlinFunction(SESSION, 'private fun isLocked(')).toMatch(/\.isKeyguardLocked\b/);
    expect(readKotlinFunction(WATCH_SUMMON, 'private fun isLocked(')).toMatch(/\.isKeyguardLocked\b/);
  });

  it('unlocks through an activity shown over the lock screen, and summons him once unlocked', () => {
    const manifest = readSource('modules/jarvis-assistant/android/src/main/AndroidManifest.xml');
    const entry = /<activity\s+android:name="expo\.modules\.jarvisassistant\.JarvisUnlockActivity"[^>]*\/>/.exec(
      manifest,
    )?.[0];

    expect(entry, 'the manifest should declare JarvisUnlockActivity').toBeDefined();
    expect(entry).toMatch(/android:showWhenLocked="true"/);
    expect(entry).toMatch(/android:exported="false"/);

    const unlock = readSource(UNLOCK);
    expect(unlock).toMatch(/requestDismissKeyguard\(/);
    expect(readKotlinFunction(UNLOCK, 'override fun onDismissSucceeded(')).toMatch(/summonJarvis\(\)/);
    expect(readKotlinFunction(UNLOCK, 'private fun summonJarvis(')).toMatch(
      /JarvisVoiceInteractionService\.summon\(\)/,
    );
  });
});
