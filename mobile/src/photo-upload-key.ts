import { readStoredValue, writeStoredValue } from './key-value-store';

/**
 * The photo upload key: the one secret of the Jarvis server's that this phone holds, and only if sir
 * gives it one.
 *
 * **Why the phone holds a server secret at all.** The upload route on the Mastra server has to be
 * reachable past Cloudflare Access, which the phone cannot pass, so anybody can send to it. The
 * single-use URL Mastra mints for each photo is a good capability, but it is not a secret only the
 * phone knows: it reaches the phone inside an MCP result that ElevenLabs relays, so it has passed
 * through a third party on the way. The key is typed into this phone by hand and never travels with
 * a conversation, so the server asks for it, as `Authorization: Bearer <key>`, in front of the slot
 * (`mcp/mastra/verticals/vision/upload-key.ts`). A URL seen anywhere else then lets nothing in.
 *
 * **Optional, and off without it.** Photos are the only thing it is for, so a phone without one
 * talks to Jarvis exactly as before and simply offers no camera: no button, nothing told to the
 * agent, and an `openCamera` call answered at once with where to add it (`camera-tool.ts`). A
 * server without one refuses every photo, so the two fail closed together. A key changed on the
 * settings screen starts a new conversation, since the one running was built with the old key
 * (`settings-screen.tsx`), and a summoning reads it again in case the other window changed it
 * (`app.tsx`).
 *
 * **Never the watch's.** It is not part of `ElevenLabsSettings`, which is what is handed across to
 * the watch, and nothing sends it there: the watch has no camera, so it would be a secret on a
 * second device for nothing. It is sent with a photo, to the address Mastra minted for that photo,
 * and nowhere else (`photo-upload.ts`).
 *
 * Kept like the API key — the Android keystore, or `localStorage` in a browser — and under a key of
 * its own, so the two can be saved and read without either having to know the other's shape.
 */

/** The variable the server reads it from, which the settings screen names so the two can be matched. */
export const PHOTO_UPLOAD_KEY_VARIABLE = 'HEY_JARVIS_PHOTO_UPLOAD_KEY';

/**
 * The shortest key the server accepts, in characters.
 *
 * The server counts a shorter one as no key and refuses every photo, so the settings screen refuses
 * it here with the reason, rather than saving a key that turns the camera on for photos that can
 * never arrive. `photo-upload-key.contract.spec.ts` reads the server's number and holds them together.
 */
export const MIN_PHOTO_UPLOAD_KEY_LENGTH = 16;

const STORAGE_KEY = 'jarvis.photo-upload-key';

/**
 * What an `Authorization` header can carry: printable ASCII, and no spaces.
 *
 * A header value is bytes, and React Native's `fetch` and a browser's both refuse to send one with a
 * character outside that range — as a thrown request, which would read as a server that could not be
 * reached. A space would split `Bearer <key>` into a token the server does not read as the key.
 */
const HEADER_SAFE = /^[\x21-\x7E]+$/;

/**
 * Turns what was typed into a key the server could accept, or explains why it cannot be one.
 *
 * Nothing typed is a valid answer — it is how the camera is switched off — so an empty field is no
 * key rather than a problem. Surrounding whitespace is forgiven, as it is for the API key, since
 * pasting picks it up; the server trims its copy the same way.
 */
export function parsePhotoUploadKey(typed: string): { key: string | undefined } | { problem: string } {
  const key = typed.trim();
  if (!key) {
    return { key: undefined };
  }
  if (key.length < MIN_PHOTO_UPLOAD_KEY_LENGTH) {
    return { problem: `The photo upload key is at least ${MIN_PHOTO_UPLOAD_KEY_LENGTH} characters.` };
  }
  if (!HEADER_SAFE.test(key)) {
    return {
      problem: 'The photo upload key can only be letters, digits and punctuation, with no spaces. Paste just the key.',
    };
  }
  return { key };
}

/**
 * What came back: a key, none kept, or a read that failed — the same three answers
 * `settings-storage.ts` gives, for the same reason.
 *
 * **A read that fails is not yet "no key".** It is read at the same moment as the settings, from the
 * same keystore, in a window the system has only just made — exactly the read that can throw while
 * the native module is still coming up. Folded into "none", one such throw took the camera away from
 * every summoning of the assistant's window, with the key in the keystore the whole time. So
 * `app.tsx` tries again, as it does for the settings, and only a key that still cannot be read is
 * no key: the camera stays off, which is what failing closed means here.
 */
export type StoredPhotoUploadKey = { kind: 'key'; key: string } | { kind: 'nothing' } | { kind: 'unreadable' };

/**
 * Reads the stored key, saying which of the three things happened. A stored value is parsed again on
 * the way out, so nothing that could not have been saved is ever sent.
 */
export async function loadPhotoUploadKey(): Promise<StoredPhotoUploadKey> {
  let stored: string | undefined;
  try {
    stored = await readStoredValue(STORAGE_KEY);
  } catch {
    return { kind: 'unreadable' };
  }

  const parsed = parsePhotoUploadKey(stored ?? '');
  return 'key' in parsed && parsed.key !== undefined ? { kind: 'key', key: parsed.key } : { kind: 'nothing' };
}

/**
 * The settings screen changing the key: the one to keep instead, `undefined` for none.
 *
 * A save that leaves the field as it was is no change at all, and is reported as none rather than
 * as the field's value — see `elevenlabs-fields.tsx` for the key that would otherwise be erased.
 */
export interface PhotoUploadKeyChange {
  key: string | undefined;
}

/**
 * Keeps the key, or forgets it. No key is stored as an empty string, which reads back as none — the
 * store has no way to delete an entry, and an empty one is what an unset field saves as.
 */
export async function savePhotoUploadKey(key: string | undefined): Promise<void> {
  await writeStoredValue(STORAGE_KEY, key ?? '');
}
