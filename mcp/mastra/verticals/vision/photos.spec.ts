import { beforeEach, describe, expect, it } from 'bun:test';
import {
  claimUploadSlot,
  findPhoto,
  forgetPhotos,
  KEEP_PHOTO_MS,
  keepPhoto,
  LATEST_PHOTO_STANDS_IN_MS,
  MAX_KEPT_PHOTOS,
  MAX_OPEN_SLOTS,
  openUploadSlot,
  UPLOAD_SLOT_MS,
} from './photos.js';

const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

beforeEach(() => {
  forgetPhotos();
});

describe('a slot for one photo', () => {
  it('is named by a token nobody could guess, and a different one every time', () => {
    const tokens = new Set(Array.from({ length: 10 }, () => openUploadSlot(0).uploadToken));

    expect(tokens.size).toBe(10);
    for (const token of tokens) {
      // 128 bits as base64url: 22 characters the phone's upload URL check accepts.
      expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
  });

  it('can be claimed once, and only while it is open', () => {
    const { uploadToken, expiresAt } = openUploadSlot(0);

    expect(expiresAt).toBe(UPLOAD_SLOT_MS);
    expect(claimUploadSlot(uploadToken, UPLOAD_SLOT_MS - 1)).toBe(true);
    expect(claimUploadSlot(uploadToken, UPLOAD_SLOT_MS - 1)).toBe(false);
  });

  it('closes when its time is up', () => {
    const { uploadToken } = openUploadSlot(0);

    expect(claimUploadSlot(uploadToken, UPLOAD_SLOT_MS)).toBe(false);
  });

  it('cannot be claimed by a name that was never given out', () => {
    expect(claimUploadSlot('Q2hhbmdlIG1lIHBsZWFzZQ', 0)).toBe(false);
  });

  it('never lets so many be open that minting them could fill memory', () => {
    const first = openUploadSlot(0).uploadToken;
    for (let slot = 1; slot < MAX_OPEN_SLOTS; slot += 1) {
      openUploadSlot(0);
    }
    const newest = openUploadSlot(0).uploadToken;

    // The oldest made way for the newest.
    expect(claimUploadSlot(first, 0)).toBe(false);
    expect(claimUploadSlot(newest, 0)).toBe(true);
  });
});

describe('the photos kept', () => {
  it('are named photo1, photo2 and on, short enough for a planner to repeat', () => {
    expect(keepPhoto(PHOTO, 'image/jpeg', 0).photoId).toBe('photo1');
    expect(keepPhoto(PHOTO, 'image/jpeg', 0).photoId).toBe('photo2');
  });

  it('are found by their id', () => {
    const first = keepPhoto(PHOTO, 'image/jpeg', 0);
    keepPhoto(Buffer.from([1]), 'image/png', 0);

    expect(findPhoto('photo1', 0)).toBe(first);
  });

  it('are found by an id that lost its shape on the way through two models', () => {
    const first = keepPhoto(PHOTO, 'image/jpeg', 0);
    keepPhoto(Buffer.from([1]), 'image/png', 0);

    expect(findPhoto('Photo 1', 0)).toBe(first);
    expect(findPhoto('"photo1".', 0)).toBe(first);
  });

  it('find nothing for an id that names no photo, rather than answering about another one', () => {
    keepPhoto(PHOTO, 'image/jpeg', 0);

    expect(findPhoto('photo99', 0)).toBeUndefined();
    expect(findPhoto('the receipt', 0)).toBeUndefined();
  });

  it('stand in with the latest for a question that named none, while it is recent', () => {
    keepPhoto(PHOTO, 'image/jpeg', 0);
    const latest = keepPhoto(Buffer.from([1]), 'image/png', 0);

    expect(findPhoto(undefined, LATEST_PHOTO_STANDS_IN_MS - 1)).toBe(latest);
    expect(findPhoto(undefined, LATEST_PHOTO_STANDS_IN_MS)).toBeUndefined();
    // Still kept, and still found by name.
    expect(findPhoto('photo2', LATEST_PHOTO_STANDS_IN_MS)).toBe(latest);
  });

  it('are let go of once they have been kept long enough', () => {
    keepPhoto(PHOTO, 'image/jpeg', 0);

    expect(findPhoto('photo1', KEEP_PHOTO_MS - 1)?.photoId).toBe('photo1');
    expect(findPhoto('photo1', KEEP_PHOTO_MS)).toBeUndefined();
  });

  it('are never more than a few, the oldest going first', () => {
    for (let photo = 0; photo <= MAX_KEPT_PHOTOS; photo += 1) {
      keepPhoto(PHOTO, 'image/jpeg', 0);
    }

    // The first has gone.
    expect(findPhoto('photo1', 0)).toBeUndefined();
    expect(findPhoto(undefined, 0)?.photoId).toBe(`photo${MAX_KEPT_PHOTOS + 1}`);
    expect(findPhoto('photo2', 0)?.photoId).toBe('photo2');
  });

  it('are nothing to find when none has been kept', () => {
    expect(findPhoto(undefined, 0)).toBeUndefined();
    expect(findPhoto('photo1', 0)).toBeUndefined();
  });
});
