import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test';
import {
  claimUploadSlot,
  dismissPhoto,
  findPhoto,
  forgetPhotos,
  howLongAgo,
  KEEP_PHOTO_MS,
  keepPhoto,
  LATEST_PHOTO_STANDS_IN_MS,
  MAX_KEPT_PHOTOS,
  MAX_OPEN_SLOTS,
  markPhotoLookedAt,
  openUploadSlot,
  photosWaiting,
  UPLOAD_SLOT_MS,
  unmarkPhotoLookedAt,
} from './photos.js';

const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

beforeEach(() => {
  forgetPhotos();
});

// The store is the process's, and every spec file runs in the same one: a photo left waiting here
// would be brought up by the next file's routing requests.
afterEach(() => {
  forgetPhotos();
});

describe('a slot for one photo', () => {
  it('is named by a token nobody could guess, and a different one every time', () => {
    const tokens = new Set(Array.from({ length: 10 }, () => openUploadSlot(0).uploadToken));

    expect(tokens.size).toBe(10);
    for (const token of tokens) {
      // 128 bits as base64url: the 22 characters the phone's check of an upload path accepts.
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

/**
 * The half hour kept on a timer, not only whenever the store is next touched.
 *
 * On Bun's fake timers, so that half an hour passes at once. Every look here asks at the moment the
 * photo was kept, when a prune would let go of nothing: a photo that is gone is gone because its
 * timer let go of it.
 */
describe('a photo whose half hour is up', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    // Before the real timers are back, so that the fake ones are what is stopped.
    forgetPhotos();
    jest.useRealTimers();
  });

  it('is let go of on time, though nothing has touched the store since', () => {
    keepPhoto(PHOTO, 'image/jpeg', 0);

    jest.advanceTimersByTime(KEEP_PHOTO_MS - 1);
    expect(findPhoto('photo1', 0)?.photoId).toBe('photo1');

    jest.advanceTimersByTime(1);
    expect(findPhoto('photo1', 0)).toBeUndefined();
    expect(photosWaiting(0)).toEqual([]);
  });

  it('is let go of on its own time, leaving a later photo its own', () => {
    keepPhoto(PHOTO, 'image/jpeg', 0);
    jest.advanceTimersByTime(60_000);
    keepPhoto(PHOTO, 'image/jpeg', 0);

    jest.advanceTimersByTime(KEEP_PHOTO_MS - 60_000);

    expect(findPhoto('photo1', 0)).toBeUndefined();
    expect(findPhoto('photo2', 0)?.photoId).toBe('photo2');
  });

  it('lets go of nothing else when it was let go of early to make room', () => {
    for (let photo = 0; photo <= MAX_KEPT_PHOTOS; photo += 1) {
      keepPhoto(PHOTO, 'image/jpeg', 0);
    }
    expect(findPhoto('photo1', 0)).toBeUndefined();

    jest.advanceTimersByTime(KEEP_PHOTO_MS);

    expect(findPhoto(undefined, 0)).toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not let go of a photo given its id after every photo was forgotten', () => {
    keepPhoto(PHOTO, 'image/jpeg', 0);
    forgetPhotos();
    jest.advanceTimersByTime(KEEP_PHOTO_MS / 2);
    const fresh = keepPhoto(PHOTO, 'image/jpeg', 0);

    // When the forgotten photo1's half hour would have been up.
    jest.advanceTimersByTime(KEEP_PHOTO_MS / 2);
    expect(findPhoto('photo1', 0)).toBe(fresh);

    jest.advanceTimersByTime(KEEP_PHOTO_MS / 2);
    expect(findPhoto('photo1', 0)).toBeUndefined();
  });
});

describe('a photo nobody has looked at yet', () => {
  it('is waiting from the moment it is kept', () => {
    const photo = keepPhoto(PHOTO, 'image/jpeg', 1_000);

    expect(photo.lookedAt).toBeUndefined();
    expect(photosWaiting(1_000)).toEqual([{ photoId: 'photo1', keptAt: 1_000 }]);
  });

  it('stops waiting once it has been looked at, and remembers when that first was', () => {
    keepPhoto(PHOTO, 'image/jpeg', 0);

    markPhotoLookedAt('photo1', 5_000);
    markPhotoLookedAt('photo1', 9_000);

    expect(photosWaiting(9_000)).toEqual([]);
    expect(findPhoto('photo1', 9_000)?.lookedAt).toBe(5_000);
  });

  it('is marked by an id that lost its shape on the way through two models', () => {
    keepPhoto(PHOTO, 'image/jpeg', 0);

    markPhotoLookedAt('Photo 1', 0);

    expect(photosWaiting(0)).toEqual([]);
  });

  it('leaves the others waiting, oldest first', () => {
    keepPhoto(PHOTO, 'image/jpeg', 0);
    keepPhoto(PHOTO, 'image/jpeg', 10);
    keepPhoto(PHOTO, 'image/jpeg', 20);

    markPhotoLookedAt('photo2', 30);

    expect(photosWaiting(30)).toEqual([
      { photoId: 'photo1', keptAt: 0 },
      { photoId: 'photo3', keptAt: 20 },
    ]);
  });

  it('is marked for nothing when the id names no photo kept', () => {
    keepPhoto(PHOTO, 'image/jpeg', 0);

    markPhotoLookedAt('photo99', 0);

    expect(photosWaiting(0)).toEqual([{ photoId: 'photo1', keptAt: 0 }]);
  });

  it('stops waiting once sir says he wants nothing done with it, without counting as looked at', () => {
    keepPhoto(PHOTO, 'image/jpeg', 0);
    keepPhoto(PHOTO, 'image/jpeg', 10);

    dismissPhoto('Photo 1', 5_000);
    dismissPhoto('photo1', 9_000);

    expect(photosWaiting(9_000)).toEqual([{ photoId: 'photo2', keptAt: 10 }]);
    // Still kept, so a question he thinks better of a minute later finds it.
    expect(findPhoto('photo1', 9_000)?.dismissedAt).toBe(5_000);
    expect(findPhoto('photo1', 9_000)?.lookedAt).toBeUndefined();
  });

  it('is dismissed for nothing when the id names no photo kept', () => {
    keepPhoto(PHOTO, 'image/jpeg', 0);

    dismissPhoto('photo99', 0);

    expect(photosWaiting(0)).toEqual([{ photoId: 'photo1', keptAt: 0 }]);
  });

  it('stops waiting once it is let go of, since nothing could look at it any more', () => {
    keepPhoto(PHOTO, 'image/jpeg', 0);
    keepPhoto(PHOTO, 'image/jpeg', 60_000);

    expect(photosWaiting(KEEP_PHOTO_MS)).toEqual([{ photoId: 'photo2', keptAt: 60_000 }]);
  });

  it('is forgotten with every other photo, and a new one waits afresh under the first id', () => {
    keepPhoto(PHOTO, 'image/jpeg', 0);
    markPhotoLookedAt('photo1', 0);

    forgetPhotos();
    const fresh = keepPhoto(PHOTO, 'image/jpeg', 0);

    expect(fresh.photoId).toBe('photo1');
    expect(fresh.lookedAt).toBeUndefined();
    expect(fresh.dismissedAt).toBeUndefined();
    expect(photosWaiting(0)).toEqual([{ photoId: 'photo1', keptAt: 0 }]);
  });
});

describe('how long ago, in words to be read out', () => {
  it('is "just now" inside a minute, and whole minutes after that', () => {
    expect(howLongAgo(59_999)).toBe('just now');
    expect(howLongAgo(60_000)).toBe('a minute ago');
    expect(howLongAgo(4 * 60_000 + 59_999)).toBe('4 minutes ago');
  });
});

/**
 * A look whose reading never reached sir — the request that looked was superseded before its report
 * was read — is taken back, so the photo is brought up later rather than lost (see `carryOut` in
 * `routing/controller.ts`).
 */
describe('a look taken back', () => {
  it('leaves the photo waiting again, however the id was written', () => {
    keepPhoto(PHOTO, 'image/jpeg', 0);
    markPhotoLookedAt('photo1', 1_000);

    unmarkPhotoLookedAt('Photo 1', 2_000);

    expect(photosWaiting(2_000)).toEqual([{ photoId: 'photo1', keptAt: 0 }]);
    expect(findPhoto('photo1', 2_000)?.lookedAt).toBeUndefined();
  });

  it('counts the next look as the first, since none reached him before it', () => {
    keepPhoto(PHOTO, 'image/jpeg', 0);
    markPhotoLookedAt('photo1', 1_000);
    unmarkPhotoLookedAt('photo1', 2_000);

    markPhotoLookedAt('photo1', 3_000);

    expect(findPhoto('photo1', 3_000)?.lookedAt).toBe(3_000);
  });

  it('leaves a photo he wants nothing done with dismissed', () => {
    keepPhoto(PHOTO, 'image/jpeg', 0);
    markPhotoLookedAt('photo1', 1_000);
    dismissPhoto('photo1', 1_500);

    unmarkPhotoLookedAt('photo1', 2_000);

    expect(photosWaiting(2_000)).toEqual([]);
  });

  it('changes nothing when the id names no photo kept', () => {
    keepPhoto(PHOTO, 'image/jpeg', 0);
    markPhotoLookedAt('photo1', 1_000);

    unmarkPhotoLookedAt('photo9', 2_000);

    expect(photosWaiting(2_000)).toEqual([]);
  });
});
