import { beforeEach, describe, expect, it, mock } from 'bun:test';

/**
 * The store is the one thing here that needs a device: on a phone it is the Android keystore, by way
 * of `expo-secure-store`, which cannot even be imported without React Native. So it is replaced with
 * a map before the module under test is loaded — which is why that is a dynamic import below the
 * mock rather than an import at the top.
 */
const stored = new Map<string, string>();
let storeWorks = true;

mock.module('./key-value-store', () => ({
  readStoredValue: async (key: string) => {
    if (!storeWorks) {
      throw new Error('The keystore key was invalidated');
    }
    return stored.get(key);
  },
  writeStoredValue: async (key: string, value: string) => {
    stored.set(key, value);
  },
}));

const { loadPhotoUploadKey, MIN_PHOTO_UPLOAD_KEY_LENGTH, parsePhotoUploadKey, savePhotoUploadKey } = await import(
  './photo-upload-key'
);

/** A key of the shape a password manager makes: long, and nothing a header cannot carry. */
const KEY = 'u8Jq-2vN_x9P!rT4sK7w';

describe('reading the key sir typed', () => {
  it('takes a key the server would take', () => {
    expect(parsePhotoUploadKey(KEY)).toEqual({ key: KEY });
  });

  it('forgives the whitespace a paste picks up, as the server does', () => {
    expect(parsePhotoUploadKey(`  ${KEY}\n`)).toEqual({ key: KEY });
  });

  it('reads an empty field as no key, which is how the camera is switched off', () => {
    expect(parsePhotoUploadKey('')).toEqual({ key: undefined });
    expect(parsePhotoUploadKey('   ')).toEqual({ key: undefined });
  });

  it('refuses a key shorter than the server accepts, and says how long it has to be', () => {
    // The server counts a short key as none and refuses every photo, so saving one would turn the
    // camera on for photos that could never arrive.
    expect(parsePhotoUploadKey('x'.repeat(MIN_PHOTO_UPLOAD_KEY_LENGTH - 1))).toEqual({
      problem: 'The photo upload key is at least 16 characters.',
    });
    expect(parsePhotoUploadKey('x'.repeat(MIN_PHOTO_UPLOAD_KEY_LENGTH))).toEqual({
      key: 'x'.repeat(MIN_PHOTO_UPLOAD_KEY_LENGTH),
    });
  });

  it('refuses anything an Authorization header cannot carry as one token', () => {
    for (const unsendable of [
      'two words pasted together',
      'a-key-with-a\ttab-in-it',
      'æøå-not-in-ascii-at-all',
      'a-key-with-an-emoji-🔑-in-it',
      `${KEY}\u0000`,
    ]) {
      const parsed = parsePhotoUploadKey(unsendable);
      expect('problem' in parsed, unsendable).toBe(true);
    }
  });
});

describe('keeping the key', () => {
  beforeEach(() => {
    stored.clear();
    storeWorks = true;
  });

  it('reads back what was saved', async () => {
    await savePhotoUploadKey(KEY);

    expect(await loadPhotoUploadKey()).toEqual({ kind: 'key', key: KEY });
  });

  it('forgets it when saved as none, and reads that back as none', async () => {
    await savePhotoUploadKey(KEY);
    await savePhotoUploadKey(undefined);

    expect(stored.get('jarvis.photo-upload-key')).toBe('');
    expect(await loadPhotoUploadKey()).toEqual({ kind: 'nothing' });
  });

  it('has none on a phone that was never given one', async () => {
    expect(await loadPhotoUploadKey()).toEqual({ kind: 'nothing' });
  });

  it('tells a store that cannot be read apart from one with no key, so the read can be tried again', async () => {
    // Folded into "none", one throw in a window still coming up took the camera away for good.
    await savePhotoUploadKey(KEY);
    storeWorks = false;

    expect(await loadPhotoUploadKey()).toEqual({ kind: 'unreadable' });
  });

  it('never hands back a stored value that could not have been saved', async () => {
    stored.set('jarvis.photo-upload-key', 'too short');

    expect(await loadPhotoUploadKey()).toEqual({ kind: 'nothing' });
  });

  it('is kept apart from the ElevenLabs settings, which are what the watch is sent', async () => {
    await savePhotoUploadKey(KEY);

    expect([...stored.keys()]).toEqual(['jarvis.photo-upload-key']);
  });
});
