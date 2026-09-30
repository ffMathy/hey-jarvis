import { PHOTO_LONG_EDGE, PHOTO_QUALITY } from './photo-upload';
import type { CameraAnswer, TakePhoto } from './platform-contracts';

/** No file picked: sir backed out of the picker. */
const CLOSED: CameraAnswer = { closed: true };

/** A file picked that could not be drawn and encoded as a photo. */
const NOT_READABLE: CameraAnswer = { notReadable: true };

/**
 * Takes a photo in a browser: the file picker, which a phone's browser opens on its camera
 * (`capture`) and a desktop's opens on its files — a receipt already on disk is as good to show him.
 *
 * **The picker is opened before anything is awaited**, because that is the only moment a browser
 * lets it open at all. It answers `change` with a file or `cancel` without one, and is gone either
 * way. What was picked is drawn onto a canvas no longer than {@link PHOTO_LONG_EDGE} and sent as a
 * JPEG, like the phone's photos — a browser applies the photo's EXIF orientation as it decodes, so
 * it arrives upright here without being asked.
 *
 * **A file that will not draw is not a picker closed.** `accept="image/*"` lets through images the
 * browser cannot decode — an iPhone's HEIC, on most desktops — and sir, who picked one, is told it
 * could not be read rather than left waiting on a photo Jarvis thinks he never sent.
 */
export const takePhoto: TakePhoto = () =>
  new Promise((resolve) => {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.setAttribute('capture', 'environment');
    picker.style.display = 'none';

    const finish = (answer: CameraAnswer | Promise<CameraAnswer>) => {
      picker.remove();
      resolve(answer);
    };
    picker.addEventListener(
      'change',
      () => {
        const picked = picker.files?.[0];
        finish(picked ? readyToSend(picked) : CLOSED);
      },
      { once: true },
    );
    picker.addEventListener('cancel', () => finish(CLOSED), { once: true });

    document.body.append(picker);
    picker.click();
  });

/** The picked file, drawn no larger than it is sent and encoded as a JPEG — or, if it will not draw, not readable. */
async function readyToSend(picked: File): Promise<CameraAnswer> {
  try {
    const image = await createImageBitmap(picked);
    const scale = Math.min(1, PHOTO_LONG_EDGE / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const drawing = canvas.getContext('2d');
    if (!drawing) {
      return NOT_READABLE;
    }
    drawing.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();

    const jpeg = await new Promise<Blob | null>((encoded) => canvas.toBlob(encoded, 'image/jpeg', PHOTO_QUALITY));
    return jpeg ? { photo: jpeg } : NOT_READABLE;
  } catch {
    return NOT_READABLE;
  }
}
