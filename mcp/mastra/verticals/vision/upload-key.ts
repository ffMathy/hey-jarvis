import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * The photo upload key: a secret sir's phone sends with every photo, as `Authorization: Bearer <key>`.
 *
 * **Why the slot is not enough on its own.** The upload route has to be reachable past Cloudflare
 * Access — the phone cannot present an Access service token — so anyone on the internet can send to
 * it. A slot's URL is a good capability, but it is not a secret only the phone holds: this server
 * writes it into an MCP result, and ElevenLabs relays that result to the phone, so it passes through
 * a third party and through whatever that party keeps. The key is entered on the phone by hand and
 * never travels with a conversation, so a URL seen anywhere else lets nothing in. The slot keeps
 * the job it had — it binds a photo to the one request it was minted for, and bounds what this
 * process holds — and the key is checked in front of it.
 *
 * **Off unless it is set.** Without a key this server takes no photos at all: `preparePhotoUpload`
 * says so instead of opening a slot the phone could never fill, and the route answers `503`. A key
 * shorter than {@link MIN_PHOTO_UPLOAD_KEY_LENGTH} counts as none, and the server says why once, at
 * startup ({@link whyPhotoUploadsAreOff}).
 *
 * **Never printed.** Not the key, and not what a caller sent in its place: the length of a key that
 * is too short is all of it that reaches a log, as the repository's rules on secrets allow.
 */

/** Where the key comes from: `mcp/op.optional.env`, and the phone's settings name it too. */
export const PHOTO_UPLOAD_KEY_VARIABLE = 'HEY_JARVIS_PHOTO_UPLOAD_KEY';

/**
 * The shortest key accepted, in characters.
 *
 * A key is only as strong as it is long, and the route it guards is one anybody can send to as
 * often as they like. The phone's settings screen refuses a shorter one with the same number, and a
 * contract test in `mobile` reads it from this line.
 */
export const MIN_PHOTO_UPLOAD_KEY_LENGTH = 16;

/** `Bearer <token>`, with the scheme in any case, as RFC 7235 has it. */
const BEARER_CREDENTIALS = /^Bearer\s+(\S+)\s*$/i;

/** The variable's value without the whitespace a pasted secret tends to pick up, or `undefined`. */
function readPhotoUploadKey(): string | undefined {
  return process.env[PHOTO_UPLOAD_KEY_VARIABLE]?.trim() || undefined;
}

/**
 * The key photos have to carry, or `undefined` when there is none to check against.
 *
 * Read from the environment on every call rather than once at import, so a test can set it and a
 * key that is too short is treated as no key at all rather than as a weak one.
 */
export function configuredPhotoUploadKey(): string | undefined {
  const key = readPhotoUploadKey();
  return key && key.length >= MIN_PHOTO_UPLOAD_KEY_LENGTH ? key : undefined;
}

/**
 * Why photo uploads are off, for the one line the MCP server logs at startup — or `undefined` when
 * they are on.
 */
export function whyPhotoUploadsAreOff(): string | undefined {
  const key = readPhotoUploadKey();
  if (!key) {
    return `Photo uploads are off: ${PHOTO_UPLOAD_KEY_VARIABLE} is not set, so preparePhotoUpload opens no slots and the photo route answers 503.`;
  }
  if (key.length < MIN_PHOTO_UPLOAD_KEY_LENGTH) {
    return `Photo uploads are off: ${PHOTO_UPLOAD_KEY_VARIABLE} is ${key.length} characters long, and it has to be at least ${MIN_PHOTO_UPLOAD_KEY_LENGTH}.`;
  }
  return undefined;
}

/** A fixed-length digest of a key, so two of them can be compared without their lengths showing. */
function digestOf(key: string): Buffer {
  return createHash('sha256').update(key, 'utf8').digest();
}

/**
 * Whether an `Authorization` header carries the expected key.
 *
 * **Compared in constant time.** A plain `===` stops at the first character that differs, and how
 * long it took says how many were right — a leak someone can measure from outside if they ask often
 * enough. Both sides are hashed first, so `timingSafeEqual` always compares two buffers of the same
 * length and neither the key's length nor its prefix shows in the time taken.
 */
export function holdsPhotoUploadKey(authorization: string | undefined, expected: string): boolean {
  const presented = authorization?.match(BEARER_CREDENTIALS)?.[1];
  if (!presented || !expected) {
    return false;
  }
  return timingSafeEqual(digestOf(presented), digestOf(expected));
}
