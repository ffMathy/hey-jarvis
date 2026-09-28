import { PHOTO_LONG_EDGE, PHOTO_QUALITY } from './photo-upload';
import type { TakePhoto } from './platform-contracts';

/**
 * Whether the camera can come up without a tap. In a browser it cannot: a file picker only opens
 * inside the gesture that asked for it, and a tool call from the agent is not a gesture. So when
 * Jarvis asks here, the camera button lights up and waits to be pressed. See `camera-tool.ts`.
 */
export const CAMERA_OPENS_WITHOUT_A_TAP = false;

/**
 * Takes a photo in a browser: the file picker, which a phone's browser opens on its camera
 * (`capture`) and a desktop's opens on its files — a receipt already on disk is as good to show him.
 *
 * **The picker is opened before anything is awaited**, because that is the only moment a browser
 * lets it open at all. It answers `change` with a file or `cancel` without one, and is gone either
 * way. What was picked is drawn onto a canvas no longer than {@link PHOTO_LONG_EDGE} and sent as a
 * JPEG, like the phone's photos — a browser applies the photo's EXIF orientation as it decodes, so
 * it arrives upright here without being asked.
 */
export const takePhoto: TakePhoto = () =>
  new Promise((resolve) => {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.setAttribute('capture', 'environment');
    picker.style.display = 'none';

    const finish = (photo: Promise<Blob | undefined> | undefined) => {
      picker.remove();
      resolve(photo);
    };
    picker.addEventListener(
      'change',
      () => {
        const picked = picker.files?.[0];
        finish(picked ? readyToSend(picked) : undefined);
      },
      { once: true },
    );
    picker.addEventListener('cancel', () => finish(undefined), { once: true });

    document.body.append(picker);
    picker.click();
  });

/** The picked file, drawn no larger than it is sent and encoded as a JPEG; `undefined` if it is not an image. */
async function readyToSend(picked: File): Promise<Blob | undefined> {
  try {
    const image = await createImageBitmap(picked);
    const scale = Math.min(1, PHOTO_LONG_EDGE / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const drawing = canvas.getContext('2d');
    if (!drawing) {
      return undefined;
    }
    drawing.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();

    return await new Promise<Blob | undefined>((encoded) =>
      canvas.toBlob((jpeg) => encoded(jpeg ?? undefined), 'image/jpeg', PHOTO_QUALITY),
    );
  } catch {
    return undefined;
  }
}
