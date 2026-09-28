import { CAMERA_NOT_OPENED, NO_PHOTO_TAKEN, NO_UPLOAD_URL } from 'hologram';

/**
 * Where a photo for Jarvis stands, between the two things that have to meet for one to be sent.
 *
 * **A photo is sent only when both halves are there**: the agent's `openCamera` call, and a photo sir
 * took — and only to the upload URL Mastra minted for it, which reaches the device just before the
 * call does (see `camera-request.ts` in `hologram`). Either half can come first. Jarvis asking opens
 * the camera and waits for the shot; sir tapping the camera button opens it at once and asks Jarvis
 * for a URL in the same moment, so the photo is often in hand before the call arrives — and is held
 * until it does. Whichever half arrives second is what sends it.
 *
 * **Every call is answered.** The agent waits on it (see `camera-request.ts` in `hologram`), so a
 * photo not taken, or a tap that never came, is an answer too. A camera closed empty-handed before
 * the call arrived is remembered for {@link REMEMBER_A_REFUSAL_MS}, so the call that comes after it
 * is told there is nothing to see rather than opening the camera again.
 *
 * Kept free of React and timers, with the time handed in, like `quiet-hang-up.ts`: what the photo
 * is, and who is waiting on it, belong to the hook in `camera-tool.ts`; what to do next is decided
 * here, where each rule is a test.
 */
export interface PhotoRequest {
  /** The upload URL Mastra minted last, until a photo is sent to it. */
  uploadUrl: string | undefined;
  /** When it was minted, as far as the device knows, in milliseconds. */
  offeredAt: number | undefined;
  /** When the agent's waiting call arrived, in milliseconds, while one is waiting. */
  askedAt: number | undefined;
  /** Whether the camera is open, which is when a photo may still be on its way. */
  cameraOpen: boolean;
  /** Whether a photo taken before anyone asked for it is being held for the call that will. */
  holding: boolean;
  /** When sir last closed the camera without a photo while nobody was asking, in milliseconds. */
  declinedAt: number | undefined;
}

/** No call, no camera, no photo: where every conversation starts. */
export const NOTHING_REQUESTED: PhotoRequest = {
  uploadUrl: undefined,
  offeredAt: undefined,
  askedAt: undefined,
  cameraOpen: false,
  holding: false,
  declinedAt: undefined,
};

/**
 * How long an upload URL is good for once it has reached the device.
 *
 * Mastra keeps the slot open for five minutes from minting (`UPLOAD_SLOT_MS` in
 * `mcp/mastra/verticals/vision/photos.ts`), and the URL reaches the device within a second of that.
 * A call arriving after it has gone stale is told to fetch a fresh one rather than have its photo
 * refused at the door.
 */
export const UPLOAD_URL_LIFE_MS = 5 * 60_000;

/**
 * How long a camera closed empty-handed answers the call that follows it.
 *
 * Long enough to cover the agent fetching an upload URL and calling back, which is a second or
 * three; short enough that a request made a minute later opens the camera as asked.
 */
export const REMEMBER_A_REFUSAL_MS = 60_000;

/**
 * How long a call waits for a tap where the camera needs one — a browser.
 *
 * Under the two minutes the agent waits for the answer (`responseTimeoutSecs`), so the answer that
 * no photo is coming arrives while it is still listening for one.
 */
export const WAIT_FOR_A_TAP_MS = 90_000;

/** Something that happened to the photo or to the call waiting for it. `at` is milliseconds, any clock. */
export type PhotoEvent =
  /** Mastra minted somewhere to send a photo, and ElevenLabs relayed it. */
  | { type: 'offered'; uploadUrl: string; at: number }
  /** The agent called `openCamera`. */
  | { type: 'asked'; at: number }
  /** The camera came up, whoever asked for it. */
  | { type: 'cameraOpened' }
  /** Sir took a photo. */
  | { type: 'photoTaken' }
  /** The camera closed without one. */
  | { type: 'noPhotoTaken'; at: number }
  /** Time passed, which is what gives up on a tap that is not coming. */
  | { type: 'tick'; at: number }
  /** The conversation ended, or a new one is starting. */
  | { type: 'sessionOver' };

/** What to do about it. */
export type PhotoStep =
  | { type: 'wait' }
  /** Open the camera now, for the call that has just arrived. */
  | { type: 'openCamera' }
  /** The camera cannot open without a tap here: ask for one. */
  | { type: 'askForATap' }
  /** The photo and the URL are both here: send it, and answer the call with what became of it. */
  | { type: 'send'; uploadUrl: string }
  /** Answer the waiting call with this, and send nothing. */
  | { type: 'answer'; answer: string }
  /** Nothing is to be answered or sent any more; let go of what was held. */
  | { type: 'forget' };

/** The request after one more event, and what to do about it. */
export function afterPhotoEvent(
  request: PhotoRequest,
  event: PhotoEvent,
  { opensWithoutATap }: { opensWithoutATap: boolean },
): { request: PhotoRequest; step: PhotoStep } {
  switch (event.type) {
    case 'offered':
      return { request: { ...request, uploadUrl: event.uploadUrl, offeredAt: event.at }, step: { type: 'wait' } };

    case 'asked':
      return afterAsked(request, event.at, opensWithoutATap);

    case 'cameraOpened':
      return { request: { ...request, cameraOpen: true, declinedAt: undefined }, step: { type: 'wait' } };

    case 'photoTaken':
      // A call only waits with a URL in hand — see `afterAsked` — so a waiting call has somewhere to send it.
      if (request.askedAt !== undefined && request.uploadUrl !== undefined) {
        return {
          request: spent({ ...request, cameraOpen: false }),
          step: { type: 'send', uploadUrl: request.uploadUrl },
        };
      }
      // Sir was quicker than the agent: hold it for the call his tap asked for.
      return { request: { ...request, cameraOpen: false, holding: true }, step: { type: 'wait' } };

    case 'noPhotoTaken':
      if (request.askedAt !== undefined) {
        return { request: spent({ ...request, cameraOpen: false }), step: { type: 'answer', answer: NO_PHOTO_TAKEN } };
      }
      return { request: { ...request, cameraOpen: false, declinedAt: event.at }, step: { type: 'wait' } };

    case 'tick':
      if (request.askedAt !== undefined && !request.cameraOpen && event.at - request.askedAt >= WAIT_FOR_A_TAP_MS) {
        return { request: spent(request), step: { type: 'answer', answer: CAMERA_NOT_OPENED } };
      }
      return { request, step: { type: 'wait' } };

    case 'sessionOver':
      return { request: NOTHING_REQUESTED, step: { type: 'forget' } };
  }
}

/** A call has arrived: send what is held, answer what was refused, or get a photo for it. */
function afterAsked(
  request: PhotoRequest,
  at: number,
  opensWithoutATap: boolean,
): { request: PhotoRequest; step: PhotoStep } {
  const { uploadUrl, offeredAt } = request;
  if (uploadUrl === undefined || offeredAt === undefined || at - offeredAt > UPLOAD_URL_LIFE_MS) {
    // Nowhere to send a photo: the agent is told to fetch somewhere first, and a photo already held
    // stays held for the call that comes after.
    return {
      request: { ...request, uploadUrl: undefined, offeredAt: undefined },
      step: { type: 'answer', answer: NO_UPLOAD_URL },
    };
  }

  if (request.holding) {
    return { request: { ...spent(request), holding: false }, step: { type: 'send', uploadUrl } };
  }

  if (request.declinedAt !== undefined && at - request.declinedAt <= REMEMBER_A_REFUSAL_MS && !request.cameraOpen) {
    return { request: { ...spent(request), declinedAt: undefined }, step: { type: 'answer', answer: NO_PHOTO_TAKEN } };
  }

  const waiting = { ...request, askedAt: at, declinedAt: undefined };
  if (request.cameraOpen) {
    // Sir opened it himself, and this is the call his tap asked for.
    return { request: waiting, step: { type: 'wait' } };
  }
  return { request: waiting, step: { type: opensWithoutATap ? 'openCamera' : 'askForATap' } };
}

/** The call answered, and its URL used up: a slot takes one photo. */
function spent(request: PhotoRequest): PhotoRequest {
  return { ...request, uploadUrl: undefined, offeredAt: undefined, askedAt: undefined };
}
