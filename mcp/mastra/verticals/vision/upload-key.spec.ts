import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  configuredPhotoUploadKey,
  holdsPhotoUploadKey,
  MIN_PHOTO_UPLOAD_KEY_LENGTH,
  PHOTO_UPLOAD_KEY_VARIABLE,
  whyPhotoUploadsAreOff,
} from './upload-key.js';

/** A key of exactly the shortest length accepted, so a character less is one too few. */
const KEY = 'k3y-of-sixteen!!';

const environmentKeys = [PHOTO_UPLOAD_KEY_VARIABLE] as const;
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));

beforeEach(() => {
  for (const key of environmentKeys) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('the names the phone repeats', () => {
  it('is the variable the phone settings screen tells sir to copy', () => {
    expect(PHOTO_UPLOAD_KEY_VARIABLE).toBe('HEY_JARVIS_PHOTO_UPLOAD_KEY');
  });

  it('is sixteen characters at the least, as the phone checks it', () => {
    expect(MIN_PHOTO_UPLOAD_KEY_LENGTH).toBe(16);
    expect(KEY).toHaveLength(MIN_PHOTO_UPLOAD_KEY_LENGTH);
  });
});

describe('the key this server checks against', () => {
  it('is nothing when the variable is not set, or set to nothing but whitespace', () => {
    expect(configuredPhotoUploadKey()).toBeUndefined();

    process.env[PHOTO_UPLOAD_KEY_VARIABLE] = '   \n';
    expect(configuredPhotoUploadKey()).toBeUndefined();
  });

  it('is the value without the whitespace a pasted secret picks up', () => {
    process.env[PHOTO_UPLOAD_KEY_VARIABLE] = `  ${KEY}\n`;

    expect(configuredPhotoUploadKey()).toBe(KEY);
  });

  it('is nothing when the value is shorter than the shortest key, however it is padded', () => {
    process.env[PHOTO_UPLOAD_KEY_VARIABLE] = KEY.slice(1);
    expect(configuredPhotoUploadKey()).toBeUndefined();

    process.env[PHOTO_UPLOAD_KEY_VARIABLE] = `   ${KEY.slice(1)}   `;
    expect(configuredPhotoUploadKey()).toBeUndefined();
  });

  it('is read when asked for, so a key set later is found', () => {
    expect(configuredPhotoUploadKey()).toBeUndefined();

    process.env[PHOTO_UPLOAD_KEY_VARIABLE] = KEY;

    expect(configuredPhotoUploadKey()).toBe(KEY);
  });
});

describe('why photo uploads are off, as the server logs it at startup', () => {
  it('says nothing when there is a key long enough', () => {
    process.env[PHOTO_UPLOAD_KEY_VARIABLE] = KEY;

    expect(whyPhotoUploadsAreOff()).toBeUndefined();
  });

  it('names the variable when it is not set', () => {
    expect(whyPhotoUploadsAreOff()).toContain(`${PHOTO_UPLOAD_KEY_VARIABLE} is not set`);
  });

  it('says how long a key that is too short is, and nothing else about it', () => {
    const tooShort = 'eleven-char';
    process.env[PHOTO_UPLOAD_KEY_VARIABLE] = tooShort;

    const reason = whyPhotoUploadsAreOff();

    expect(reason).toContain('11 characters long');
    expect(reason).toContain(`at least ${MIN_PHOTO_UPLOAD_KEY_LENGTH}`);
    expect(reason).not.toContain(tooShort);
  });
});

describe('whether a request holds the key', () => {
  it('holds it when the header is `Bearer` and the key', () => {
    expect(holdsPhotoUploadKey(`Bearer ${KEY}`, KEY)).toBe(true);
  });

  it('reads the scheme in any case, as RFC 7235 has it', () => {
    expect(holdsPhotoUploadKey(`bearer ${KEY}`, KEY)).toBe(true);
    expect(holdsPhotoUploadKey(`BEARER ${KEY}`, KEY)).toBe(true);
    expect(holdsPhotoUploadKey(`bEaReR  ${KEY}`, KEY)).toBe(true);
  });

  it('does not hold it without a header, or with nothing after the scheme', () => {
    expect(holdsPhotoUploadKey(undefined, KEY)).toBe(false);
    expect(holdsPhotoUploadKey('', KEY)).toBe(false);
    expect(holdsPhotoUploadKey('Bearer', KEY)).toBe(false);
    expect(holdsPhotoUploadKey('Bearer ', KEY)).toBe(false);
  });

  it('does not hold it under another scheme, or with no scheme at all', () => {
    expect(holdsPhotoUploadKey(`Basic ${KEY}`, KEY)).toBe(false);
    expect(holdsPhotoUploadKey(`Token ${KEY}`, KEY)).toBe(false);
    expect(holdsPhotoUploadKey(KEY, KEY)).toBe(false);
    expect(holdsPhotoUploadKey(`Bearer${KEY}`, KEY)).toBe(false);
  });

  it('does not hold it with a key that differs anywhere, or only begins or ends like it', () => {
    expect(holdsPhotoUploadKey(`Bearer ${KEY.slice(0, -1)}X`, KEY)).toBe(false);
    expect(holdsPhotoUploadKey(`Bearer X${KEY.slice(1)}`, KEY)).toBe(false);
    expect(holdsPhotoUploadKey(`Bearer ${KEY.slice(0, -1)}`, KEY)).toBe(false);
    expect(holdsPhotoUploadKey(`Bearer ${KEY}${KEY}`, KEY)).toBe(false);
    expect(holdsPhotoUploadKey(`Bearer ${KEY.toUpperCase()}`, KEY)).toBe(false);
  });

  it('does not hold it with two tokens where one belongs', () => {
    expect(holdsPhotoUploadKey(`Bearer ${KEY} ${KEY}`, KEY)).toBe(false);
  });

  it('never matches an empty key, whatever is sent', () => {
    expect(holdsPhotoUploadKey('Bearer ', '')).toBe(false);
    expect(holdsPhotoUploadKey(`Bearer ${KEY}`, '')).toBe(false);
  });

  it('compares keys of different lengths without throwing, as timingSafeEqual would on raw strings', () => {
    // `timingSafeEqual` throws on buffers of unequal length; the digests are what keep it from
    // ever seeing one, and what keep the key's length out of the time a refusal takes.
    expect(() => holdsPhotoUploadKey('Bearer x', KEY)).not.toThrow();
    expect(holdsPhotoUploadKey('Bearer x', KEY)).toBe(false);
    expect(holdsPhotoUploadKey(`Bearer ${'x'.repeat(4096)}`, KEY)).toBe(false);
  });
});
