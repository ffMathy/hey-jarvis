import { randomBytes } from 'node:crypto';

/**
 * Photos sir has shown Jarvis, kept just long enough to be asked about.
 *
 * **In memory, in this process, and nowhere else.** A photo of a receipt, a letter or a screen is
 * private, and `/data` is persistent and goes into every Home Assistant backup — so photos are
 * never written to disk. This process is the MCP server's, which is also where `routePromptWorkflow`
 * and every agent it plans run, so the agent that looks at a photo finds it here. Studio's process
 * (`mastra dev`, port 4111) has a store of its own that nothing ever fills.
 *
 * **A photo arrives through a slot, and a slot takes one.** When sir taps the camera button, the
 * phone asks this server for a slot (`POST /api/photos/slots` in `api/routes.ts`), sending the id of
 * the ElevenLabs conversation it is in; the slot is opened only once ElevenLabs says that
 * conversation is live on Jarvis's agent (`live-conversation.ts`). The slot is named by 128 random
 * bits, handed straight back to the phone, and the first body sent there — within
 * {@link UPLOAD_SLOT_MS} — is the photo. That name is the upload's only protection: the phone holds
 * no key, and the name never passes through anyone but this server and the phone. A slot is what
 * keeps the number of photos in flight bounded, and it is claimed *before* its body is read, which
 * is what keeps a stranger from making this process buffer uploads it will only refuse: a request
 * for a slot that does not exist is turned away with nothing read, and a slot is read from once.
 *
 * **Everything is bounded**, because the Pi this runs on has two gigabytes for two processes: at
 * most {@link MAX_OPEN_SLOTS} slots and {@link MAX_KEPT_PHOTOS} photos of at most
 * {@link MAX_PHOTO_BYTES}, the oldest let go first, and nothing kept past {@link KEEP_PHOTO_MS}.
 * Pruning happens whenever the store is touched rather than on a timer, as the other short-lived
 * state in this server does.
 *
 * **A photo nobody has looked at yet is waiting** ({@link photosWaiting}). The conversation that
 * sent one is told about it by the phone and looks at it straight away, whether sir said what it is
 * for or not — but that conversation can end before the phone gets to tell it, or the look can
 * fail, so a photo is not tied to the conversation it arrived in. Routing shows every waiting photo
 * to the planner, and brings one up in a later reply to ask what he would like done with it
 * (`routing/waiting-photos.ts`); `lookAtPhoto` is what stops it waiting ({@link markPhotoLookedAt}),
 * and so does sir saying he wants nothing done with it ({@link dismissPhoto}).
 */

/**
 * How long a slot waits for its photo: the camera, the shot and the upload all fit inside it.
 *
 * The phone asks for its slot the moment sir taps the button, while the conversation is certainly
 * live, so this is also how long he has to frame the shot.
 */
export const UPLOAD_SLOT_MS = 5 * 60_000;

/** How long a photo is kept, so a follow-up question about it still finds it. */
export const KEEP_PHOTO_MS = 30 * 60_000;

/**
 * How recent the latest photo has to be to stand in for a question that names none.
 *
 * Long enough for "and how much was the milk?" straight after the total; short enough that a
 * question about something else entirely, on the watch or the speaker, is not answered from a
 * receipt shown twenty minutes ago on another call.
 */
export const LATEST_PHOTO_STANDS_IN_MS = 3 * 60_000;

/** The most photos kept at once. A household shows Jarvis one thing at a time. */
export const MAX_KEPT_PHOTOS = 5;

/** The most slots open at once, so minting them cannot be used to fill memory either. */
export const MAX_OPEN_SLOTS = 20;

/**
 * The largest photo accepted, in bytes.
 *
 * A phone sends a JPEG no longer than 1600 pixels at quality 0.85 (`PHOTO_LONG_EDGE` in
 * `mobile/src/photo-upload.ts`), which is a few hundred kilobytes; three megabytes is room for a
 * busy scene without being room for a stranger's ten.
 */
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

/** The kinds of image a photo may be. The phone only ever sends JPEG. */
export const PHOTO_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type PhotoMediaType = (typeof PHOTO_MEDIA_TYPES)[number];

/** A photo as it is kept. */
export interface KeptPhoto {
  /** What the agents call it: `photo1`, `photo2`… Short, because a planner has to repeat it. */
  photoId: string;
  data: Buffer;
  mediaType: PhotoMediaType;
  /** When it arrived, in milliseconds. */
  keptAt: number;
  /** When an agent first looked at it, in milliseconds — or `undefined` while nobody has. */
  lookedAt: number | undefined;
  /**
   * When sir said he wants nothing done with it, in milliseconds — or `undefined` if he has not.
   * Kept apart from {@link lookedAt} because nobody has looked at such a photo: it has only stopped
   * waiting.
   */
  dismissedAt: number | undefined;
}

/** A photo nobody has looked at yet, as far as anything outside this store needs to know it. */
export interface WaitingPhoto {
  photoId: string;
  /** When it arrived, in milliseconds. */
  keptAt: number;
}

/** Open slots by token, with the moment each stops taking a photo. */
const openSlots = new Map<string, number>();

/** Kept photos by id, oldest first — a `Map` iterates in the order entries went in. */
const keptPhotos = new Map<string, KeptPhoto>();

/** How many photos this process has kept, which is what the next id counts from. */
let photosKept = 0;

/** Lets go of whatever has outlived its time. */
function prune(now: number): void {
  for (const [uploadToken, expiresAt] of openSlots) {
    if (expiresAt <= now) {
      openSlots.delete(uploadToken);
    }
  }
  for (const [photoId, photo] of keptPhotos) {
    if (now - photo.keptAt >= KEEP_PHOTO_MS) {
      keptPhotos.delete(photoId);
    }
  }
}

/** Lets go of the oldest entries until `entries` has room for `limit` - 1 plus the one about to go in. */
function makeRoom<Value>(entries: Map<string, Value>, limit: number): void {
  for (const key of entries.keys()) {
    if (entries.size < limit) {
      return;
    }
    entries.delete(key);
  }
}

/** Opens a slot for one photo, and says what to call it and until when it is open. */
export function openUploadSlot(now = Date.now()): { uploadToken: string; expiresAt: number } {
  prune(now);
  makeRoom(openSlots, MAX_OPEN_SLOTS);

  // 128 bits, URL-safe: 22 characters nobody can guess, and all that lets a photo in.
  const uploadToken = randomBytes(16).toString('base64url');
  const expiresAt = now + UPLOAD_SLOT_MS;
  openSlots.set(uploadToken, expiresAt);
  return { uploadToken, expiresAt };
}

/**
 * Takes the slot for the body about to be read, if there is a live one by this name.
 *
 * Called before a single byte of the upload is read. It is gone once claimed, so a slot is read
 * from once whether or not what arrives turns out to be a photo.
 */
export function claimUploadSlot(uploadToken: string, now = Date.now()): boolean {
  prune(now);
  return openSlots.delete(uploadToken);
}

/** Keeps a photo that came in through a claimed slot, and says what it is called now. */
export function keepPhoto(data: Buffer, mediaType: PhotoMediaType, now = Date.now()): KeptPhoto {
  prune(now);
  makeRoom(keptPhotos, MAX_KEPT_PHOTOS);

  photosKept += 1;
  const photo: KeptPhoto = {
    photoId: `photo${photosKept}`,
    data,
    mediaType,
    keptAt: now,
    lookedAt: undefined,
    dismissedAt: undefined,
  };
  keptPhotos.set(photo.photoId, photo);
  return photo;
}

/** A photo id as it is kept, from however a model wrote it: "Photo 3" is `photo3`. */
function canonicalPhotoId(photoId: string): string {
  return photoId.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The photo by this id — or, when no id is given, the latest photo if it is recent.
 *
 * **An id is matched however the models wrote it.** It passes through two before it arrives here —
 * the voice agent's query and the planner's prompt — and either may write "Photo 3" for `photo3`, so
 * spaces and punctuation are dropped before it is looked up. An id that names no photo kept here
 * finds nothing: answering about some other photo would be answering the wrong question with
 * confidence.
 *
 * **The latest stands in only for a question that named none, and only for a while**
 * ({@link LATEST_PHOTO_STANDS_IN_MS}): a planner that dropped the id from a follow-up still means the
 * photo just shown, and anything older is more likely a different question altogether.
 */
export function findPhoto(photoId: string | undefined, now = Date.now()): KeptPhoto | undefined {
  prune(now);
  const wanted = photoId === undefined ? undefined : canonicalPhotoId(photoId);
  if (wanted) {
    return keptPhotos.get(wanted);
  }
  const photos = [...keptPhotos.values()];
  const latest = photos[photos.length - 1];
  return latest && now - latest.keptAt < LATEST_PHOTO_STANDS_IN_MS ? latest : undefined;
}

/**
 * Records that an agent has looked at a photo, so it is no longer waiting.
 *
 * The first look is the one kept: what matters is only whether anyone has, and a follow-up question
 * about the same photo is not a reason to think it was ever overlooked.
 */
export function markPhotoLookedAt(photoId: string, now = Date.now()): void {
  prune(now);
  const photo = keptPhotos.get(canonicalPhotoId(photoId));
  if (photo && photo.lookedAt === undefined) {
    photo.lookedAt = now;
  }
}

/**
 * Takes back a look at a photo whose reading never reached sir, so it is waiting again.
 *
 * A look is marked the moment the reader answers, but what it read only reaches sir in the closing
 * report of the request that looked — and a request he talks over is superseded, and its report is
 * never read. Such a photo was neither described to him nor asked about, and marked as looked at it
 * would never be brought up either: the one thing waiting photos are for is that a photo he sent is
 * not lost. So routing puts it back (see `carryOut` in `routing/controller.ts`), and the next request
 * he hears brings it up like any other. A photo he said he wants nothing done with stays dismissed.
 */
export function unmarkPhotoLookedAt(photoId: string, now = Date.now()): void {
  prune(now);
  const photo = keptPhotos.get(canonicalPhotoId(photoId));
  if (photo) {
    photo.lookedAt = undefined;
  }
}

/**
 * Records that sir wants nothing done with a photo, so it is no longer waiting.
 *
 * "Nothing, I was only testing" is a reply to being asked about a photo like any other, and without
 * this it had nowhere to go: routed, it planned no work, and was reported to him as a request that
 * could not be completed. The photo is kept rather than let go of, so a question about it that he
 * thinks better of a minute later still finds it — it is only no longer brought up.
 */
export function dismissPhoto(photoId: string, now = Date.now()): void {
  prune(now);
  const photo = keptPhotos.get(canonicalPhotoId(photoId));
  if (photo && photo.dismissedAt === undefined) {
    photo.dismissedAt = now;
  }
}

/**
 * The photos kept that nobody has looked at yet, and that sir has not said he wants nothing done
 * with, oldest first.
 *
 * Only while they are kept: a photo let go of is not waiting on anyone, since nothing could look at
 * it any more.
 */
export function photosWaiting(now = Date.now()): WaitingPhoto[] {
  prune(now);
  return [...keptPhotos.values()]
    .filter((photo) => photo.lookedAt === undefined && photo.dismissedAt === undefined)
    .map(({ photoId, keptAt }) => ({ photoId, keptAt }));
}

/** How long ago something happened, in words for an answer that will be read out. */
export function howLongAgo(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) {
    return 'just now';
  }
  return minutes === 1 ? 'a minute ago' : `${minutes} minutes ago`;
}

/** Forgets every slot and photo — and with them which were looked at — and starts the ids again. For tests. */
export function forgetPhotos(): void {
  openSlots.clear();
  keptPhotos.clear();
  photosKept = 0;
}
