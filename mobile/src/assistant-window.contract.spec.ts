import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WINDOW_PUT_AWAY } from '../modules/jarvis-assistant';
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

const MODULE =
  'modules/jarvis-assistant/android/src/main/java/expo/modules/jarvisassistant/JarvisAssistantModule.kt';

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
    expect(readKotlinConstant('WINDOW_PUT_AWAY', MODULE)).toBe(WINDOW_PUT_AWAY);
  });
});
