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
 * most {@link MAX_OPEN_SLOTS} slots, {@link MAX_KEPT_PHOTOS} photos and {@link MAX_KEPT_SCREENSHOTS}
 * screenshots of at most {@link MAX_PHOTO_BYTES}, the oldest let go first, and nothing kept past
 * {@link KEEP_PHOTO_MS}. Slots are pruned whenever the store is touched, as the other short-lived
 * state in this server is, and the oldest photo is let go of the moment a new one needs its room. A
 * photo's own day is kept **on a timer**
 * ({@link letGoOfPhotoOnTime}), because it is a promise — the privacy policy makes it — about how
 * long sir's photo is held at all: pruned only when touched, a letter shown one evening, with nobody
 * talking to Jarvis again for a weekend, would sit in this process's memory until then.
 *
 * **A photo nobody has looked at yet is waiting** ({@link photosWaiting}). The conversation that
 * sent one is told about it by the phone and looks at it straight away, whether sir said what it is
 * for or not — but that conversation can end before the phone gets to tell it, or the look can
 * fail, so a photo is not tied to the conversation it arrived in. Routing shows every waiting photo
 * to the planner, and brings one up in a later reply to ask what he would like done with it
 * (`routing/waiting-photos.ts`); `lookAtPhoto` is what stops it waiting ({@link markPhotoLookedAt}),
 * and so does sir saying he wants nothing done with it ({@link dismissPhoto}), and so does
 * {@link PHOTO_WAITS_FOR_MS} passing: it is still kept for the rest of its day, and found by its id,
 * but no longer brought up.
 *
 * **A screenshot is kept beside the photos, and never waits on anyone.** Every time sir summons
 * Jarvis from his phone, the phone sends what was on its screen at that moment (`kind: 'screenshot'`
 * in the slot request; see "What was on the screen" in `.claude/rules/mobile.md`), so that "what does this
 * say?" has something to be about. Nobody asked Jarvis to look at it, so it is never waiting
 * ({@link photosWaiting}) and never brought up, it never stands in for a question that names no photo
 * ({@link findPhoto}), and screenshots are counted apart from photos ({@link keepPhoto}): a summoning a
 * minute is not allowed to push sir's receipt out of the store.
 */

/**
 * How long a slot waits for its photo: the camera, the shot and the upload all fit inside it.
 *
 * The phone asks for its slot the moment sir taps the button, while the conversation is certainly
 * live, so this is also how long he has to frame the shot.
 */
export const UPLOAD_SLOT_MS = 5 * 60_000;

/**
 * How long a photo or a screenshot is kept: a day, so a question about it later the same day — "what
 * was the total on that receipt?" — still finds it. The same day the pages the visualize vertical
 * builds are hosted for (`ARTIFACT_LIFETIME_MILLISECONDS` in `visualize/artifact-hosting.ts`), and the
 * figure the privacy policy (`docs/privacy-policy.md`, §4) promises.
 */
export const KEEP_PHOTO_MS = 24 * 60 * 60_000;

/**
 * How long a photo nobody has looked at is *waiting* ({@link photosWaiting}), and so brought up in a
 * reply to ask what sir would like done with it.
 *
 * Shorter than it is kept, on purpose. Bringing a photo up is a reminder, and is left alone for
 * `QUESTION_REMINDER_INTERVAL_MS` between times (`routing/questions.ts`); a photo that waited the
 * whole of its day would be asked about every half hour of it. Waiting no longer than that interval,
 * it is brought up once. Past it, a photo is kept and found by its id as before — only no longer
 * raised by Jarvis on his own.
 */
export const PHOTO_WAITS_FOR_MS = 30 * 60_000;

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

/**
 * The most screenshots kept at once, apart from {@link MAX_KEPT_PHOTOS}: one arrives on every
 * summoning, so a day of them is bounded by count before it is by {@link KEEP_PHOTO_MS}. Each is a
 * few hundred kilobytes.
 */
export const MAX_KEPT_SCREENSHOTS = 10;

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

/**
 * What a photo is: one sir took to show Jarvis, or what was on his phone's screen when he summoned
 * him, which nobody has asked about yet.
 */
export const PHOTO_KINDS = ['photo', 'screenshot'] as const;

export type PhotoKind = (typeof PHOTO_KINDS)[number];

/** The kinds of image a photo may be. The phone only ever sends JPEG. */
export const PHOTO_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type PhotoMediaType = (typeof PHOTO_MEDIA_TYPES)[number];

/** A photo as it is kept. */
export interface KeptPhoto {
  /** What the agents call it: `photo1`, `photo2`… Short, because a planner has to repeat it. */
  photoId: string;
  /** Whether sir took it to show Jarvis, or it is his screen as it was when he summoned him. */
  kind: PhotoKind;
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
  /** A photo, unless it says it is a screenshot. Only one a request names can be. */
  kind?: PhotoKind;
}

/** Open slots by token, with the moment each stops taking a photo and the kind of photo it takes. */
const openSlots = new Map<string, { expiresAt: number; kind: PhotoKind }>();

/** Kept photos by id, oldest first — a `Map` iterates in the order entries went in. */
const keptPhotos = new Map<string, KeptPhoto>();

/** How many photos this process has kept, which is what the next id counts from. */
let photosKept = 0;

/** The timer that lets go of each photo when its time is up, by photo id, until it has. */
const releaseTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Lets go of whatever has outlived its time. */
function prune(now: number): void {
  for (const [uploadToken, { expiresAt }] of openSlots) {
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

/** Opens a slot for one photo of this kind, and says what to call it and until when it is open. */
export function openUploadSlot(
  now = Date.now(),
  kind: PhotoKind = 'photo',
): { uploadToken: string; expiresAt: number } {
  prune(now);
  makeRoom(openSlots, MAX_OPEN_SLOTS);

  // 128 bits, URL-safe: 22 characters nobody can guess, and all that lets a photo in.
  const uploadToken = randomBytes(16).toString('base64url');
  const expiresAt = now + UPLOAD_SLOT_MS;
  openSlots.set(uploadToken, { expiresAt, kind });
  return { uploadToken, expiresAt };
}

/**
 * Takes the slot for the body about to be read, if there is a live one by this name, and says what
 * kind of photo it was opened for — or `undefined` when there is no such slot.
 *
 * Called before a single byte of the upload is read. It is gone once claimed, so a slot is read
 * from once whether or not what arrives turns out to be a photo.
 */
export function claimUploadSlot(uploadToken: string, now = Date.now()): PhotoKind | undefined {
  prune(now);
  const slot = openSlots.get(uploadToken);
  openSlots.delete(uploadToken);
  return slot?.kind;
}

/**
 * Lets go of a photo whose {@link KEEP_PHOTO_MS} is up, whether or not anything has touched the store
 * since: what {@link keepPhoto} schedules for each photo it keeps.
 *
 * **By id, and that is enough.** An id is never given to a second photo while this process runs —
 * the count only grows — except after {@link forgetPhotos}, which stops every timer first. So the
 * photo this finds under its id is the one it was scheduled for, or none: one already let go of, to
 * make room or by a prune, is simply not there. The timer holds the id and nothing else, so a photo let
 * go of early is not held in memory, by the timer that would have let go of it, for the rest of its
 * half hour.
 */
function letGoOfPhotoOnTime(photoId: string): void {
  releaseTimers.delete(photoId);
  keptPhotos.delete(photoId);
}

/** Lets go of a kept photo now, and of the timer that would have let go of it later. */
function letGoOfPhoto(photoId: string): void {
  clearTimeout(releaseTimers.get(photoId));
  letGoOfPhotoOnTime(photoId);
}

/**
 * Keeps a photo that came in through a claimed slot, and says what it is called now.
 *
 * **Screenshots are counted apart from photos**: at most {@link MAX_KEPT_SCREENSHOTS} of them, beside
 * sir's {@link MAX_KEPT_PHOTOS} photos rather than instead of them, since the phone sends one on every
 * summoning.
 */
export function keepPhoto(
  data: Buffer,
  mediaType: PhotoMediaType,
  now = Date.now(),
  kind: PhotoKind = 'photo',
): KeptPhoto {
  prune(now);
  const sameKind = [...keptPhotos.values()].filter((kept) => kept.kind === kind);
  const room = kind === 'screenshot' ? MAX_KEPT_SCREENSHOTS : MAX_KEPT_PHOTOS;
  for (const oldest of sameKind.slice(0, Math.max(0, sameKind.length - room + 1))) {
    letGoOfPhoto(oldest.photoId);
  }

  photosKept += 1;
  const photo: KeptPhoto = {
    photoId: `photo${photosKept}`,
    kind,
    data,
    mediaType,
    keptAt: now,
    lookedAt: undefined,
    dismissedAt: undefined,
  };
  keptPhotos.set(photo.photoId, photo);

  // Unref'd: a photo waiting out its half hour is no reason for the process to keep running.
  const releaseTimer = setTimeout(letGoOfPhotoOnTime, KEEP_PHOTO_MS, photo.photoId);
  releaseTimer.unref();
  releaseTimers.set(photo.photoId, releaseTimer);
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
 * photo just shown, and anything older is more likely a different question altogether. Only a photo
 * sir took stands in, never a screenshot: one arrives on every summoning, so "the latest" would
 * otherwise be his screen rather than the receipt he showed a minute ago.
 */
export function findPhoto(photoId: string | undefined, now = Date.now()): KeptPhoto | undefined {
  prune(now);
  const wanted = photoId === undefined ? undefined : canonicalPhotoId(photoId);
  if (wanted) {
    return keptPhotos.get(wanted);
  }
  const photos = [...keptPhotos.values()].filter((photo) => photo.kind === 'photo');
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
 * it any more — and only for {@link PHOTO_WAITS_FOR_MS} of that. Never a screenshot, which sir did
 * not send to be looked at.
 */
export function photosWaiting(now = Date.now()): WaitingPhoto[] {
  prune(now);
  return [...keptPhotos.values()]
    .filter(
      (photo) =>
        photo.kind === 'photo' &&
        photo.lookedAt === undefined &&
        photo.dismissedAt === undefined &&
        now - photo.keptAt < PHOTO_WAITS_FOR_MS,
    )
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

/**
 * Forgets every slot and photo — and with them which were looked at — and starts the ids again. For
 * tests. The timers go too, since the ids they carry are about to be given out again.
 */
export function forgetPhotos(): void {
  for (const releaseTimer of releaseTimers.values()) {
    clearTimeout(releaseTimer);
  }
  releaseTimers.clear();
  openSlots.clear();
  keptPhotos.clear();
  photosKept = 0;
}
