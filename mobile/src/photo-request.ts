import { CAMERA_NOT_OPENED, NO_PHOTO_TAKEN, NO_UPLOAD_URL, PHOTOS_UNAVAILABLE } from './camera-answers';

/**
 * Where a photo for Jarvis stands, between the things that have to meet for one to be sent.
 *
 * **A photo is sent only when all three are there**: the agent's `openCamera` call, a photo sir
 * took, and the upload URL Mastra minted for it — which reaches the device as a relayed MCP result,
 * usually just before the call does (see `camera-answers.ts`). Any of them can come
 * first. Jarvis asking opens the camera and waits for the shot; sir tapping the camera button opens
 * it at once and asks Jarvis for a URL in the same moment, so the photo is often in hand before the
 * call arrives, and is held until it does. Whichever arrives last is what sends it.
 *
 * **Every call is answered.** The agent waits on it, so a photo not taken, a tap that never came
 * and a URL that never arrived are answers too. A camera closed empty-handed before the call arrived
 * is remembered for {@link REMEMBER_A_REFUSAL_MS}, so the call that comes after it is told there is
 * nothing to see rather than opening the camera again.
 *
 * **Nothing is kept for long.** A photo held for a call that never came is let go after
 * {@link HOLD_A_PHOTO_MS} — or the next request, minutes later, would be answered with it instead
 * of opening the camera.
 *
 * Kept free of React and timers, with the time handed in: what the photo
 * is, and who is waiting on it, belong to the hook in `camera-tool.ts`; what to do next — and when
 * to look again ({@link nextLook}) — is decided here, where each rule is a test.
 */
export interface PhotoRequest {
  /** The upload URL Mastra minted last, until a photo is sent to it. */
  uploadUrl: string | undefined;
  /** When it reached the device, in milliseconds. */
  offeredAt: number | undefined;
  /** When the agent's waiting call arrived, in milliseconds, while one is waiting. */
  askedAt: number | undefined;
  /** Whether the camera is open, which is when a photo may still be on its way. */
  cameraOpen: boolean;
  /** When a photo taken before anyone asked for it was put aside for the call that will, while one is. */
  heldAt: number | undefined;
  /** When sir last closed the camera without a photo while nobody was asking, in milliseconds. */
  declinedAt: number | undefined;
  /** When a call was last told there was nowhere to send a photo, in milliseconds. */
  urlMissedAt: number | undefined;
}

/** No call, no camera, no photo: where every conversation starts. */
export const NOTHING_REQUESTED: PhotoRequest = {
  uploadUrl: undefined,
  offeredAt: undefined,
  askedAt: undefined,
  cameraOpen: false,
  heldAt: undefined,
  declinedAt: undefined,
  urlMissedAt: undefined,
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
 * How long a call waits for its upload URL to arrive.
 *
 * The URL comes over the same connection just before the call, so it is normally already here. A
 * short wait covers the two arriving the other way round — which a model calling both tools in one
 * turn could do — before the call is told to fetch one.
 */
export const WAIT_FOR_THE_URL_MS = 2_500;

/**
 * How long a call told there was nowhere to send a photo makes the next one give up instead.
 *
 * Told once, the agent fetches a URL and calls again. Told twice in a row, whatever carries the URL
 * to the device is not getting through, and a third time would be going round in circles.
 */
export const REMEMBER_A_MISS_MS = 60_000;

/**
 * How long a photo taken before anyone asked for it is held for the call sir's tap asked for.
 *
 * The call normally comes within seconds. One that has not come in a minute is not coming — the
 * model did something else — and the photo must not answer some later, unrelated request.
 */
export const HOLD_A_PHOTO_MS = 60_000;

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
 * Short, because nothing else keeps the conversation alive meanwhile: ElevenLabs ends a call thirty
 * seconds after sir last spoke (`silenceEndCallTimeout`), whatever the agent is waiting on, and the
 * shot and the upload still have to fit in after the tap. Jarvis has just said he wants to see
 * something and the button has lit up, so a tap that is coming comes quickly.
 */
export const WAIT_FOR_A_TAP_MS = 25_000;

/** Something that happened to the photo or to the call waiting for it. `at` is milliseconds, any clock. */
export type PhotoEvent =
  /** Mastra minted somewhere to send a photo, and ElevenLabs relayed it. */
  | { type: 'offered'; uploadUrl: string; at: number }
  /** The agent called `openCamera`. */
  | { type: 'asked'; at: number }
  /** The camera came up, whoever asked for it. */
  | { type: 'cameraOpened' }
  /** Sir took a photo. */
  | { type: 'photoTaken'; at: number }
  /** The camera closed without one. */
  | { type: 'noPhotoTaken'; at: number }
  /** Time passed, which is what gives up on a URL or a tap that is not coming. See {@link nextLook}. */
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
  /** The photo, the URL and the call are all here: send it, and answer the call with what became of it. */
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
    case 'offered': {
      const offered = { ...request, uploadUrl: event.uploadUrl, offeredAt: event.at };
      // A call that was waiting for exactly this goes ahead now.
      return request.askedAt !== undefined && request.uploadUrl === undefined
        ? goAhead(offered, event.at, opensWithoutATap)
        : { request: offered, step: { type: 'wait' } };
    }

    case 'asked':
      return afterAsked(request, event.at, opensWithoutATap);

    case 'cameraOpened':
      return { request: { ...request, cameraOpen: true, declinedAt: undefined }, step: { type: 'wait' } };

    case 'photoTaken':
      if (request.askedAt !== undefined && request.uploadUrl !== undefined) {
        return {
          request: spent({ ...request, cameraOpen: false }),
          step: { type: 'send', uploadUrl: request.uploadUrl },
        };
      }
      // Sir was quicker than the agent, or than the URL: hold it for the call his tap asked for.
      return { request: { ...request, cameraOpen: false, heldAt: event.at }, step: { type: 'wait' } };

    case 'noPhotoTaken':
      if (request.askedAt !== undefined) {
        return {
          request: spent({ ...request, cameraOpen: false }),
          step: { type: 'answer', answer: NO_PHOTO_TAKEN },
        };
      }
      return { request: { ...request, cameraOpen: false, declinedAt: event.at }, step: { type: 'wait' } };

    case 'tick':
      return afterTick(request, event.at);

    case 'sessionOver':
      return { request: NOTHING_REQUESTED, step: { type: 'forget' } };
  }
}

/**
 * When a `tick` could next change something, or `undefined` if nothing is waiting on the clock.
 *
 * The hook sets its one timer from this, so the clock is only ever running while a call is.
 */
export function nextLook(request: PhotoRequest): number | undefined {
  if (request.askedAt === undefined) {
    return undefined;
  }
  if (request.uploadUrl === undefined) {
    return request.askedAt + WAIT_FOR_THE_URL_MS;
  }
  // Waiting on a tap; a camera that is open is sir framing the shot, and is never hurried.
  return request.cameraOpen ? undefined : request.askedAt + WAIT_FOR_A_TAP_MS;
}

/** A call has arrived: go ahead if there is somewhere to send the photo, or wait a moment for the URL. */
function afterAsked(
  request: PhotoRequest,
  at: number,
  opensWithoutATap: boolean,
): { request: PhotoRequest; step: PhotoStep } {
  const { uploadUrl, offeredAt } = request;
  const fresh = uploadUrl !== undefined && offeredAt !== undefined && at - offeredAt <= UPLOAD_URL_LIFE_MS;
  if (!fresh) {
    return {
      request: { ...request, askedAt: at, uploadUrl: undefined, offeredAt: undefined },
      step: { type: 'wait' },
    };
  }
  return goAhead({ ...request, askedAt: at }, at, opensWithoutATap);
}

/** A call with somewhere to send the photo: send what is held, answer what was refused, or get a photo for it. */
function goAhead(
  request: PhotoRequest,
  at: number,
  opensWithoutATap: boolean,
): { request: PhotoRequest; step: PhotoStep } {
  const { uploadUrl } = request;
  if (uploadUrl === undefined) {
    return { request, step: { type: 'wait' } };
  }

  if (request.heldAt !== undefined && at - request.heldAt <= HOLD_A_PHOTO_MS) {
    return { request: spent(request), step: { type: 'send', uploadUrl } };
  }

  if (request.declinedAt !== undefined && at - request.declinedAt <= REMEMBER_A_REFUSAL_MS && !request.cameraOpen) {
    return {
      request: { ...spent(request), declinedAt: undefined },
      step: { type: 'answer', answer: NO_PHOTO_TAKEN },
    };
  }

  // A photo held too long is not this call's photo.
  const waiting = { ...request, heldAt: undefined, declinedAt: undefined };
  if (request.cameraOpen) {
    // Sir opened it himself, and this is the call his tap asked for.
    return { request: waiting, step: { type: 'wait' } };
  }
  return { request: waiting, step: { type: opensWithoutATap ? 'openCamera' : 'askForATap' } };
}

/** Gives up on a URL, or a tap, that has not come in time. */
function afterTick(request: PhotoRequest, at: number): { request: PhotoRequest; step: PhotoStep } {
  const due = nextLook(request);
  if (due === undefined || at < due) {
    return { request, step: { type: 'wait' } };
  }

  if (request.uploadUrl === undefined) {
    const missedJustNow = request.urlMissedAt !== undefined && at - request.urlMissedAt <= REMEMBER_A_MISS_MS;
    // A photo already held stays held: the agent fetches a URL and calls again for it.
    return {
      request: { ...request, askedAt: undefined, urlMissedAt: at },
      step: { type: 'answer', answer: missedJustNow ? PHOTOS_UNAVAILABLE : NO_UPLOAD_URL },
    };
  }
  return { request: spent(request), step: { type: 'answer', answer: CAMERA_NOT_OPENED } };
}

/** The call answered, and its URL and photo used up: a slot takes one photo, and a photo one call. */
function spent(request: PhotoRequest): PhotoRequest {
  return { ...request, uploadUrl: undefined, offeredAt: undefined, askedAt: undefined, heldAt: undefined };
}
