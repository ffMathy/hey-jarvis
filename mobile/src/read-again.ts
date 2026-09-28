/**
 * How hard to try to read something kept in the keystore before giving up on it.
 *
 * Only a read that *failed* is retried — something simply not there is answered the first time. See
 * {@link readTryingAgain}.
 */
export const READ_ATTEMPTS = 4;
export const READ_AGAIN_MS = 200;

/**
 * Reads something kept in the keystore, and tries again if the *reading* failed rather than the
 * thing being absent.
 *
 * The two are not the same, and used to be answered the same way. A read that throws in the
 * assistant's own window — a surface the system has only just created, where a native module can
 * still be coming up — landed as "nothing configured", and a summoned Jarvis opened sample mode with
 * credentials sitting in the keystore the whole time. That is what the blank sheet was. The photo
 * upload key is read from the same keystore at the same moment, and its failed read took the camera
 * away in the same way. A handful of attempts a fifth of a second apart costs nothing and covers it.
 *
 * Whatever is read says which it was, as `settings-storage.ts` and `photo-upload-key.ts` both answer:
 * a `kind` of `'unreadable'` is tried again. What comes back is the first other answer, or
 * `undefined` when every attempt failed — or once nobody wants the answer any more.
 */
export async function readTryingAgain<Stored extends { kind: string }>(
  read: () => Promise<Stored>,
  stillWanted: () => boolean,
): Promise<Stored | undefined> {
  for (let attempt = 1; attempt <= READ_ATTEMPTS && stillWanted(); attempt++) {
    const stored = await read();
    if (stored.kind !== 'unreadable') {
      return stored;
    }
    if (attempt < READ_ATTEMPTS) {
      await new Promise((wait) => setTimeout(wait, READ_AGAIN_MS));
    }
  }
  return undefined;
}
