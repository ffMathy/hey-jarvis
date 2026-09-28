import { describe, expect, it } from 'bun:test';
import { CAMERA_NOT_OPENED, NO_PHOTO_TAKEN, NO_UPLOAD_URL, PHOTOS_UNAVAILABLE } from './camera-answers';
import {
  afterPhotoEvent,
  HOLD_A_PHOTO_MS,
  NOTHING_REQUESTED,
  nextLook,
  type PhotoEvent,
  type PhotoRequest,
  type PhotoStep,
  REMEMBER_A_REFUSAL_MS,
  UPLOAD_URL_LIFE_MS,
  WAIT_FOR_A_TAP_MS,
  WAIT_FOR_THE_URL_MS,
} from './photo-request';

const UPLOAD_URL = 'https://jarvis.example.com/api/photos/Q2hhbmdlIG1lIHBsZWFzZQ';

/** Mastra minting somewhere to send the photo, relayed to the device just before the call that uses it. */
function offered(at = 0): PhotoEvent {
  return { type: 'offered', uploadUrl: UPLOAD_URL, at };
}

function asked(at = 0): PhotoEvent {
  return { type: 'asked', at };
}

function taken(at = 0): PhotoEvent {
  return { type: 'photoTaken', at };
}

const OPENED: PhotoEvent = { type: 'cameraOpened' };

/** A phone, where the agent asking is enough to bring the camera up. */
const ON_A_PHONE = { opensWithoutATap: true };
/** A browser, where the picker only opens inside a tap. */
const IN_A_BROWSER = { opensWithoutATap: false };

/** The request after each of `events` in turn, and the step the last one called for. */
function after(
  events: readonly PhotoEvent[],
  surface = ON_A_PHONE,
  from: PhotoRequest = NOTHING_REQUESTED,
): { request: PhotoRequest; step: PhotoStep } {
  return events.reduce<{ request: PhotoRequest; step: PhotoStep }>(
    ({ request }, event) => afterPhotoEvent(request, event, surface),
    { request: from, step: { type: 'wait' } },
  );
}

describe('Jarvis asking to see something', () => {
  it('opens the camera on a phone the moment he asks', () => {
    expect(after([offered(), asked()]).step).toEqual({ type: 'openCamera' });
  });

  it('asks for a tap in a browser, where a picker cannot open by itself', () => {
    expect(after([offered(), asked()], IN_A_BROWSER).step).toEqual({ type: 'askForATap' });
  });

  it('sends the photo he asked for once it is taken, to where Mastra said', () => {
    const { request, step } = after([offered(), asked(), OPENED, taken(5_000)]);

    expect(step).toEqual({ type: 'send', uploadUrl: UPLOAD_URL });
    // Sent is answered, and the URL is spent: nothing is waiting, and the camera is closed.
    expect(request).toEqual(NOTHING_REQUESTED);
  });

  it('tells him there is nothing to see when the camera closes empty-handed', () => {
    const { request, step } = after([offered(), asked(), OPENED, { type: 'noPhotoTaken', at: 5_000 }]);

    expect(step).toEqual({ type: 'answer', answer: NO_PHOTO_TAKEN });
    expect(request.askedAt).toBeUndefined();
    // Answered, so nothing is remembered against the next call.
    expect(request.declinedAt).toBeUndefined();
  });
});

describe('where a photo may go', () => {
  it('waits a moment for an upload URL that is late, and goes ahead when it comes', () => {
    const waiting = after([asked(0)]);
    expect(waiting.step).toEqual({ type: 'wait' });
    expect(nextLook(waiting.request)).toBe(WAIT_FOR_THE_URL_MS);

    expect(after([offered(1_000)], ON_A_PHONE, waiting.request).step).toEqual({ type: 'openCamera' });
  });

  it('sends him to fetch an upload URL when none arrives, and keeps the camera shut', () => {
    // A photo taken with nowhere to send it is a photo sir took for nothing.
    const { step } = after([asked(0), { type: 'tick', at: WAIT_FOR_THE_URL_MS }]);

    expect(step).toEqual({ type: 'answer', answer: NO_UPLOAD_URL });
  });

  it('does not answer before the wait is over', () => {
    expect(after([asked(0), { type: 'tick', at: WAIT_FOR_THE_URL_MS - 1 }]).step).toEqual({ type: 'wait' });
  });

  it('stops him going round in circles when the URL never arrives twice running', () => {
    const { step } = after([
      asked(0),
      { type: 'tick', at: WAIT_FOR_THE_URL_MS },
      asked(5_000),
      { type: 'tick', at: 5_000 + WAIT_FOR_THE_URL_MS },
    ]);

    expect(step).toEqual({ type: 'answer', answer: PHOTOS_UNAVAILABLE });
  });

  it('does not use an upload URL that has gone stale', () => {
    const stale = after([offered(0), asked(UPLOAD_URL_LIFE_MS + 1)]);

    expect(stale.step).toEqual({ type: 'wait' });
    expect(stale.request.uploadUrl).toBeUndefined();
  });

  it('uses a URL once: the next call has to wait for a fresh one', () => {
    const sent = after([offered(), asked(), OPENED, taken(500)]);

    expect(afterPhotoEvent(sent.request, asked(1_000), ON_A_PHONE).step).toEqual({ type: 'wait' });
    expect(afterPhotoEvent(sent.request, asked(1_000), ON_A_PHONE).request.uploadUrl).toBeUndefined();
  });

  it('keeps a photo it had nowhere to send, for the call that comes with somewhere', () => {
    const { request, step } = after([
      OPENED,
      taken(0),
      asked(1_000),
      { type: 'tick', at: 1_000 + WAIT_FOR_THE_URL_MS },
      offered(5_000),
      asked(6_000),
    ]);

    expect(step).toEqual({ type: 'send', uploadUrl: UPLOAD_URL });
    expect(request.heldAt).toBeUndefined();
  });
});

describe('sir opening the camera himself', () => {
  it('holds a photo taken before Jarvis has asked for it, and sends it the moment he does', () => {
    const holding = after([OPENED, taken(0)]);
    expect(holding.step).toEqual({ type: 'wait' });
    expect(holding.request.heldAt).toBe(0);

    const { request, step } = after([offered(2_000), asked(3_000)], ON_A_PHONE, holding.request);

    expect(step).toEqual({ type: 'send', uploadUrl: UPLOAD_URL });
    expect(request).toEqual(NOTHING_REQUESTED);
  });

  it('lets a held photo go when the call it was held for never came', () => {
    // A request minutes later is about something else, and must open the camera for it.
    const { request, step } = after([OPENED, taken(0), offered(HOLD_A_PHOTO_MS + 1), asked(HOLD_A_PHOTO_MS + 1)]);

    expect(step).toEqual({ type: 'openCamera' });
    expect(request.heldAt).toBeUndefined();
  });

  it('does not open a second camera when the call his tap asked for arrives while it is open', () => {
    const { request, step } = after([OPENED, offered(1_000), asked(2_000)]);

    expect(step).toEqual({ type: 'wait' });
    expect(request.askedAt).toBe(2_000);
    // Sir is framing the shot: nothing on the clock hurries him.
    expect(nextLook(request)).toBeUndefined();

    // And the photo, when it comes, goes to that call.
    expect(afterPhotoEvent(request, taken(9_000), ON_A_PHONE).step).toEqual({ type: 'send', uploadUrl: UPLOAD_URL });
  });

  it('answers the call his tap asked for with nothing, when he closed the camera before it came', () => {
    const { step } = after([OPENED, { type: 'noPhotoTaken', at: 4_000 }, offered(5_000), asked(6_000)]);

    // Opening the camera again would be answering a question he has already taken back.
    expect(step).toEqual({ type: 'answer', answer: NO_PHOTO_TAKEN });
  });

  it('forgets that he closed it once the call has been told, or once it is old', () => {
    const told = after([OPENED, { type: 'noPhotoTaken', at: 0 }, offered(500), asked(1_000)]);
    expect(after([offered(1_500), asked(2_000)], ON_A_PHONE, told.request).step).toEqual({ type: 'openCamera' });

    const old = after([
      OPENED,
      { type: 'noPhotoTaken', at: 0 },
      offered(REMEMBER_A_REFUSAL_MS),
      asked(REMEMBER_A_REFUSAL_MS + 1),
    ]);
    expect(old.step).toEqual({ type: 'openCamera' });
  });

  it('waits for the camera he opened again, rather than remembering that he closed it before', () => {
    const { step } = after([OPENED, { type: 'noPhotoTaken', at: 0 }, OPENED, offered(500), asked(1_000)]);

    expect(step).toEqual({ type: 'wait' });
  });
});

describe('a tap that never comes', () => {
  it('gives up on it before ElevenLabs gives up on the call, and says so', () => {
    const waiting = after([offered(), asked()], IN_A_BROWSER);
    expect(nextLook(waiting.request)).toBe(WAIT_FOR_A_TAP_MS);

    expect(afterPhotoEvent(waiting.request, { type: 'tick', at: WAIT_FOR_A_TAP_MS - 1 }, IN_A_BROWSER).step).toEqual({
      type: 'wait',
    });
    const { request, step } = afterPhotoEvent(waiting.request, { type: 'tick', at: WAIT_FOR_A_TAP_MS }, IN_A_BROWSER);
    expect(step).toEqual({ type: 'answer', answer: CAMERA_NOT_OPENED });
    expect(request.askedAt).toBeUndefined();
  });

  it('leaves time after the tap for the shot and the upload, inside the thirty seconds a silent call is given', () => {
    expect(WAIT_FOR_A_TAP_MS).toBeLessThan(30_000);
  });

  it('never gives up on a camera that is open — sir is framing the shot', () => {
    const { request } = after([offered(), asked(), OPENED]);

    expect(afterPhotoEvent(request, { type: 'tick', at: WAIT_FOR_A_TAP_MS * 10 }, ON_A_PHONE).step).toEqual({
      type: 'wait',
    });
  });

  it('keeps no clock running while nobody is waiting', () => {
    expect(nextLook(NOTHING_REQUESTED)).toBeUndefined();
    expect(nextLook(after([OPENED, taken(0)]).request)).toBeUndefined();
  });
});

describe('the conversation ending', () => {
  it('lets go of everything, so no photo from one conversation is sent into the next', () => {
    const { request, step } = after([OPENED, taken(0), offered(), { type: 'sessionOver' }]);

    expect(step).toEqual({ type: 'forget' });
    expect(request).toEqual(NOTHING_REQUESTED);
  });

  it('leaves the request it was given alone', () => {
    const before = after([offered(), asked()]).request;
    const copy = { ...before };

    afterPhotoEvent(before, taken(0), ON_A_PHONE);

    expect(before).toEqual(copy);
  });
});
