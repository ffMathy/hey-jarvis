import { returnFromTheCamera, takePhotoWithTheCameraApp } from '../modules/jarvis-assistant';
import type { TakePhoto } from './platform-contracts';

/**
 * Whether the camera can come up without a tap. On a phone it can: the agent asking is enough to
 * put the camera app in front of sir. See `take-photo.web.ts` for the browser, where it cannot.
 */
export const CAMERA_OPENS_WITHOUT_A_TAP = true;

/**
 * Takes a photo with the phone's own camera app, and reads it back as a `Blob` to send.
 *
 * The native half does the photographing, the scaling and the turning upright, and leaves a JPEG in
 * the app's cache; reading it through `fetch` is how React Native turns a `file://` URI into a
 * `Blob`, which is what `photo-upload.ts` sends — the same thing the browser's half hands it. A photo
 * that cannot be read back is a photo not taken, as far as anyone waiting on it is concerned.
 *
 * Summoned, the assistant's window was put away for the camera, and it is brought back here — before
 * the photo is read — if the conversation it holds is still open.
 */
export const takePhoto: TakePhoto = async ({ inAssistantWindow, stillTalking }) => {
  const photo = await takePhotoWithTheCameraApp({ inAssistantWindow });
  if (inAssistantWindow) {
    returnFromTheCamera({ showWindowAgain: stillTalking() });
  }
  if (!photo) {
    return undefined;
  }

  try {
    const read = await fetch(photo);
    return await read.blob();
  } catch {
    return undefined;
  }
};
