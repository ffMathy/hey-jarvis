import type { KeyValueStorage } from './settings';

/**
 * "His voice from where he stands": the 2D page's one setting of the headset's own.
 *
 * On by default. When the headset can keep a voice played through Web Audio out of its microphone,
 * his voice then comes from his spot in the room; switched off, it always comes from the headset,
 * as the SDK plays it (see `conversation/voice-route.ts`). Someone who finds the spatial voice odd,
 * or who hears it come back through the microphone before the app does, has a way to say so.
 *
 * Kept in `localStorage` under a key of this app's own, apart from the ElevenLabs settings the
 * phone shares. Still named after `horizon/`, this app's folder before it was `vr/`, so a headset
 * keeps the choice it made.
 */
export const VOICE_FROM_WHERE_HE_STANDS_KEY = 'jarvis.horizon.voice-from-where-he-stands';

/** Whether it is on: anything but a stored "off" is, a storage that throws included. */
export function loadVoiceFromWhereHeStands(storage: KeyValueStorage): boolean {
  try {
    return storage.getItem(VOICE_FROM_WHERE_HE_STANDS_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Keeps it; says why it could not, rather than throwing. */
export function saveVoiceFromWhereHeStands(storage: KeyValueStorage, on: boolean): string | undefined {
  try {
    storage.setItem(VOICE_FROM_WHERE_HE_STANDS_KEY, on ? 'on' : 'off');
    return undefined;
  } catch {
    return 'This browser would not keep the setting. Check that it allows this site to store data.';
  }
}
