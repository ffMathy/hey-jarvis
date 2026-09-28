import { describe, expect, it } from 'bun:test';
import { CAMERA_NOT_OPENED, NO_PHOTO_TAKEN, NO_UPLOAD_URL } from 'hologram';
import {
  afterPhotoEvent,
  NOTHING_REQUESTED,
  type PhotoEvent,
  type PhotoRequest,
  type PhotoStep,
  REMEMBER_A_REFUSAL_MS,
  UPLOAD_URL_LIFE_MS,
  WAIT_FOR_A_TAP_MS,
} from './photo-request';

const UPLOAD_URL = 'https://jarvis.example.com/api/photos/Q2hhbmdlIG1lIHBsZWFzZQ';

/** Mastra minting somewhere to send the photo, relayed to the device just before the call that uses it. */
function offered(at = 0): PhotoEvent {
  return { type: 'offered', uploadUrl: UPLOAD_URL, at };
}

function asked(at = 0): PhotoEvent {
  return { type: 'asked', at };
}

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
    const { request, step } = after([offered(), asked(), { type: 'cameraOpened' }, { type: 'photoTaken' }]);

    expect(step).toEqual({ type: 'send', uploadUrl: UPLOAD_URL });
    // Sent is answered, and the URL is spent: nothing is waiting, and the camera is closed.
    expect(request).toEqual(NOTHING_REQUESTED);
  });

  it('tells him there is nothing to see when the camera closes empty-handed', () => {
    const { request, step } = after([
      offered(),
      asked(),
      { type: 'cameraOpened' },
      { type: 'noPhotoTaken', at: 5_000 },
    ]);

    expect(step).toEqual({ type: 'answer', answer: NO_PHOTO_TAKEN });
    expect(request.askedAt).toBeUndefined();
    // Answered, so nothing is remembered against the next call.
    expect(request.declinedAt).toBeUndefined();
  });
});

describe('where a photo may go', () => {
  it('sends him to fetch an upload URL when Mastra has minted none', () => {
    // The camera stays shut: a photo taken with nowhere to send it is a photo sir took for nothing.
    expect(after([asked()]).step).toEqual({ type: 'answer', answer: NO_UPLOAD_URL });
  });

  it('does not use an upload URL that has gone stale', () => {
    expect(after([offered(0), asked(UPLOAD_URL_LIFE_MS + 1)]).step).toEqual({ type: 'answer', answer: NO_UPLOAD_URL });
  });

  it('uses a URL once: the next call needs a fresh one', () => {
    const sent = after([offered(), asked(), { type: 'cameraOpened' }, { type: 'photoTaken' }]);

    expect(afterPhotoEvent(sent.request, asked(1_000), ON_A_PHONE).step).toEqual({
      type: 'answer',
      answer: NO_UPLOAD_URL,
    });
  });

  it('keeps a photo it had nowhere to send, for the call that comes with somewhere', () => {
    const { request, step } = after([
      { type: 'cameraOpened' },
      { type: 'photoTaken' },
      asked(1_000),
      offered(2_000),
      asked(3_000),
    ]);

    expect(step).toEqual({ type: 'send', uploadUrl: UPLOAD_URL });
    expect(request.holding).toBe(false);
  });
});

describe('sir opening the camera himself', () => {
  it('holds a photo taken before Jarvis has asked for it, and sends it the moment he does', () => {
    const holding = after([{ type: 'cameraOpened' }, { type: 'photoTaken' }]);
    expect(holding.step).toEqual({ type: 'wait' });
    expect(holding.request.holding).toBe(true);

    const { request, step } = after([offered(2_000), asked(3_000)], ON_A_PHONE, holding.request);

    expect(step).toEqual({ type: 'send', uploadUrl: UPLOAD_URL });
    expect(request).toEqual(NOTHING_REQUESTED);
  });

  it('does not open a second camera when the call his tap asked for arrives while it is open', () => {
    const { request, step } = after([{ type: 'cameraOpened' }, offered(1_000), asked(2_000)]);

    expect(step).toEqual({ type: 'wait' });
    expect(request.askedAt).toBe(2_000);

    // And the photo, when it comes, goes to that call.
    expect(afterPhotoEvent(request, { type: 'photoTaken' }, ON_A_PHONE).step).toEqual({
      type: 'send',
      uploadUrl: UPLOAD_URL,
    });
  });

  it('answers the call his tap asked for with nothing, when he closed the camera before it came', () => {
    const { step } = after([
      { type: 'cameraOpened' },
      { type: 'noPhotoTaken', at: 4_000 },
      offered(5_000),
      asked(6_000),
    ]);

    // Opening the camera again would be answering a question he has already taken back.
    expect(step).toEqual({ type: 'answer', answer: NO_PHOTO_TAKEN });
  });

  it('forgets that he closed it once the call has been told, or once it is old', () => {
    const told = after([{ type: 'cameraOpened' }, { type: 'noPhotoTaken', at: 0 }, offered(500), asked(1_000)]);
    expect(after([offered(1_500), asked(2_000)], ON_A_PHONE, told.request).step).toEqual({ type: 'openCamera' });

    const old = after([
      { type: 'cameraOpened' },
      { type: 'noPhotoTaken', at: 0 },
      offered(REMEMBER_A_REFUSAL_MS),
      asked(REMEMBER_A_REFUSAL_MS + 1),
    ]);
    expect(old.step).toEqual({ type: 'openCamera' });
  });

  it('waits for the camera he opened again, rather than remembering that he closed it before', () => {
    const { step } = after([
      { type: 'cameraOpened' },
      { type: 'noPhotoTaken', at: 0 },
      { type: 'cameraOpened' },
      offered(500),
      asked(1_000),
    ]);

    expect(step).toEqual({ type: 'wait' });
  });
});

describe('a tap that never comes', () => {
  it('gives up on it before the agent does, and says so', () => {
    const waiting = after([offered(), asked()], IN_A_BROWSER);

    expect(afterPhotoEvent(waiting.request, { type: 'tick', at: WAIT_FOR_A_TAP_MS - 1 }, IN_A_BROWSER).step).toEqual({
      type: 'wait',
    });
    const { request, step } = afterPhotoEvent(waiting.request, { type: 'tick', at: WAIT_FOR_A_TAP_MS }, IN_A_BROWSER);
    expect(step).toEqual({ type: 'answer', answer: CAMERA_NOT_OPENED });
    expect(request.askedAt).toBeUndefined();
  });

  it('never gives up on a camera that is open — sir is framing the shot', () => {
    const { request } = after([offered(), asked(), { type: 'cameraOpened' }]);

    expect(afterPhotoEvent(request, { type: 'tick', at: WAIT_FOR_A_TAP_MS * 10 }, ON_A_PHONE).step).toEqual({
      type: 'wait',
    });
  });
});

describe('the conversation ending', () => {
  it('lets go of everything, so no photo from one conversation is sent into the next', () => {
    const { request, step } = after([
      { type: 'cameraOpened' },
      { type: 'photoTaken' },
      offered(),
      { type: 'sessionOver' },
    ]);

    expect(step).toEqual({ type: 'forget' });
    expect(request).toEqual(NOTHING_REQUESTED);
  });

  it('leaves the request it was given alone', () => {
    const before = after([offered(), asked()]).request;
    const copy = { ...before };

    afterPhotoEvent(before, { type: 'photoTaken' }, ON_A_PHONE);

    expect(before).toEqual(copy);
  });
});
