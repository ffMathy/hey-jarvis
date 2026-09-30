import { describe, expect, it } from 'bun:test';
import type { KeyValueStorage } from './settings';
import {
  loadVoiceFromWhereHeStands,
  saveVoiceFromWhereHeStands,
  VOICE_FROM_WHERE_HE_STANDS_KEY,
} from './voice-setting';

function memoryStorage(): KeyValueStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

const refusingStorage: KeyValueStorage = {
  getItem: () => {
    throw new DOMException('Storage is switched off.', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('Storage is switched off.', 'SecurityError');
  },
};

describe('"His voice from where he stands"', () => {
  it('is on until it is switched off', () => {
    const storage = memoryStorage();
    expect(loadVoiceFromWhereHeStands(storage)).toBe(true);

    expect(saveVoiceFromWhereHeStands(storage, false)).toBeUndefined();
    expect(storage.entries.get(VOICE_FROM_WHERE_HE_STANDS_KEY)).toBe('off');
    expect(loadVoiceFromWhereHeStands(storage)).toBe(false);

    saveVoiceFromWhereHeStands(storage, true);
    expect(loadVoiceFromWhereHeStands(storage)).toBe(true);
  });

  it('is on in a browser that keeps nothing, and says why it could not be kept', () => {
    expect(loadVoiceFromWhereHeStands(refusingStorage)).toBe(true);
    expect(saveVoiceFromWhereHeStands(refusingStorage, false)).toContain('would not keep the setting');
  });

  it('is kept apart from the ElevenLabs settings the phone shares', () => {
    expect(VOICE_FROM_WHERE_HE_STANDS_KEY).not.toBe('jarvis.elevenlabs-settings');
  });
});
