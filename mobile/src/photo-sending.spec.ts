import { describe, expect, it, jest, spyOn } from 'bun:test';
import { CAMERA_CLOSED, CAMERA_OPENED, PHOTO_PROBLEMS, photoNotSent, photoSent } from './photo-messages';
import { type PhotoServer, seeThePhotoThrough } from './photo-sending';
import { PHOTO_SLOT_WAIT_MS, type PhotoDelivery, type PhotoSlot } from './photo-upload';
import type { CameraAnswer } from './platform-contracts';

const CONVERSATION_ID = 'conv_01jz8k3b4c5d6e7f';
const UPLOAD_PATH = '/api/photos/Q2hhbmdlIG1lIHBsZWFzZQ';
const PHOTO = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });

/** The camera coming back with a photo. */
const TAKEN: CameraAnswer = { photo: PHOTO };

/** The camera coming back without one: sir went back. */
const WENT_BACK: CameraAnswer = { closed: true };

/** The camera coming back with something sir took or picked that could not be read as a photo. */
const NOT_READABLE: CameraAnswer = { notReadable: true };

/** A promise the test settles when it chooses: the camera, still open until it is told otherwise. */
function later<Value>() {
  let settle: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

/** Everything said into the conversation, in order, as what kind of word it was. */
type Said = { update: string } | { message: string };

/**
 * A conversation that remembers what it was told, and how often sir's activity was reported to it,
 * and a switch for whether it is still the one open.
 */
function createConversation() {
  const said: Said[] = [];
  const activity = { reported: 0 };
  let open = true;
  return {
    said,
    activity,
    end: () => {
      open = false;
    },
    stillInTheConversation: () => open,
    conversation: {
      sendContextualUpdate: (text: string) => said.push({ update: text }),
      sendText: (text: string) => said.push({ message: text }),
      sendUserActivity: () => {
        activity.reported += 1;
      },
    },
  };
}

/** A server that answers as it is told to, and remembers what it was asked. */
function createServer({
  slot = { uploadPath: UPLOAD_PATH },
  delivery = { photoId: 'photo3' },
}: {
  slot?: PhotoSlot | Promise<PhotoSlot>;
  delivery?: PhotoDelivery;
} = {}) {
  const slotsAskedFor: string[] = [];
  const photosSent: Array<{ photo: Blob; uploadPath: string }> = [];
  const server: PhotoServer = {
    openSlot: async (conversationId) => {
      slotsAskedFor.push(conversationId);
      return slot;
    },
    sendPhoto: async (photo, uploadPath) => {
      photosSent.push({ photo, uploadPath });
      return delivery;
    },
  };
  return { server, slotsAskedFor, photosSent };
}

/** Lets every promise already settled run its continuations. */
function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The same, while the clock is faked: `setImmediate` is not among the timers Bun fakes. */
function settledWhileTheClockIsStopped(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('a tap of the camera button', () => {
  it('asks for a slot, tells the agent the camera is open and says sir is there, before anything is awaited', () => {
    // All in the tap itself: the slot while the conversation is certainly live, the note so the agent
    // waits for the photo rather than hanging up on the silence, and sir's activity at once rather
    // than five seconds later, when the hook's heartbeat first comes round.
    const { said, activity, conversation, stillInTheConversation } = createConversation();
    const { server, slotsAskedFor } = createServer();

    void seeThePhotoThrough({
      photo: later<CameraAnswer>().promise,
      conversationId: CONVERSATION_ID,
      server,
      conversation,
      stillInTheConversation,
    });

    expect(slotsAskedFor).toEqual([CONVERSATION_ID]);
    expect(said).toEqual([{ update: CAMERA_OPENED }]);
    expect(activity.reported).toBe(1);
  });

  it('sends the photo to the slot, and tells the agent what it was filed as, as sir’s turn', async () => {
    const { said, conversation, stillInTheConversation } = createConversation();
    const { server, photosSent } = createServer();
    const camera = later<CameraAnswer>();

    const seen = seeThePhotoThrough({
      photo: camera.promise,
      conversationId: CONVERSATION_ID,
      server,
      conversation,
      stillInTheConversation,
    });
    await settled();
    // Nothing goes anywhere while the camera is still open.
    expect(photosSent).toHaveLength(0);

    camera.settle(TAKEN);
    await seen;

    expect(photosSent).toEqual([{ photo: PHOTO, uploadPath: UPLOAD_PATH }]);
    expect(said).toEqual([{ update: CAMERA_OPENED }, { message: photoSent('photo3') }]);
  });

  it('waits for a slot still on its way when the photo is taken first', async () => {
    const { said, conversation, stillInTheConversation } = createConversation();
    const slot = later<PhotoSlot>();
    const { server, photosSent } = createServer({ slot: slot.promise });

    const seen = seeThePhotoThrough({
      photo: Promise.resolve(TAKEN),
      conversationId: CONVERSATION_ID,
      server,
      conversation,
      stillInTheConversation,
    });
    await settled();
    expect(photosSent).toHaveLength(0);

    slot.settle({ uploadPath: UPLOAD_PATH });
    await seen;

    expect(photosSent).toHaveLength(1);
    expect(said.at(-1)).toEqual({ message: photoSent('photo3') });
  });

  it('says the camera was closed, and sends nothing, when sir backs out', async () => {
    const { said, conversation, stillInTheConversation } = createConversation();
    const { server, photosSent } = createServer();

    await seeThePhotoThrough({
      photo: Promise.resolve(WENT_BACK),
      conversationId: CONVERSATION_ID,
      server,
      conversation,
      stillInTheConversation,
    });

    expect(photosSent).toHaveLength(0);
    // In the background: nothing happened that needs a turn.
    expect(said).toEqual([{ update: CAMERA_OPENED }, { update: CAMERA_CLOSED }]);
  });

  it('takes a camera that failed outright for one closed without a photo', async () => {
    const { said, conversation, stillInTheConversation } = createConversation();
    const { server } = createServer();

    await seeThePhotoThrough({
      photo: Promise.reject(new Error('No camera app')),
      conversationId: CONVERSATION_ID,
      server,
      conversation,
      stillInTheConversation,
    });

    expect(said).toEqual([{ update: CAMERA_OPENED }, { update: CAMERA_CLOSED }]);
  });
});

describe('a photo that could not be read', () => {
  it('is not taken for a camera closed: the agent is told, as sir’s turn, that it did not reach him', async () => {
    // Sir took or picked something — an iPhone's HEIC, which a desktop browser cannot draw — and is
    // waiting to hear about it. A note that he closed the camera would leave Jarvis carrying on as if
    // he had sent nothing.
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    const { said, conversation, stillInTheConversation } = createConversation();
    const { server, photosSent } = createServer();

    await seeThePhotoThrough({
      photo: Promise.resolve(NOT_READABLE),
      conversationId: CONVERSATION_ID,
      server,
      conversation,
      stillInTheConversation,
    });

    expect(photosSent).toHaveLength(0);
    expect(said).toEqual([
      { update: CAMERA_OPENED },
      { message: "The photo I took didn't reach you: it could not be read as a photo." },
    ]);
    expect(warn).toHaveBeenCalledWith(
      'The photo for Jarvis was not sent: The photo that was taken could not be read as one.',
    );
    warn.mockRestore();
  });

  it('says nothing of it once the conversation has ended', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    const { said, conversation, stillInTheConversation, end } = createConversation();
    const { server } = createServer();
    const camera = later<CameraAnswer>();

    const seen = seeThePhotoThrough({
      photo: camera.promise,
      conversationId: CONVERSATION_ID,
      server,
      conversation,
      stillInTheConversation,
    });
    end();
    camera.settle(NOT_READABLE);
    await seen;

    expect(said).toEqual([{ update: CAMERA_OPENED }]);
    warn.mockRestore();
  });
});

describe('a server that never answers the slot request', () => {
  it('is given up on once the camera has been closed for as long as a slot is waited on, and sir is told', async () => {
    // A request the network swallowed would otherwise hold the button busy, and Jarvis waiting on a
    // photo, for the rest of the call.
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.useFakeTimers();
    try {
      const { said, conversation, stillInTheConversation } = createConversation();
      const { server, photosSent } = createServer({ slot: new Promise<PhotoSlot>(() => undefined) });
      const camera = later<CameraAnswer>();

      const seen = seeThePhotoThrough({
        photo: camera.promise,
        conversationId: CONVERSATION_ID,
        server,
        conversation,
        stillInTheConversation,
      });
      // However long sir spends framing the shot, the wait is counted from the photo, not the tap.
      jest.advanceTimersByTime(PHOTO_SLOT_WAIT_MS * 3);
      camera.settle(TAKEN);
      await settledWhileTheClockIsStopped();
      jest.advanceTimersByTime(PHOTO_SLOT_WAIT_MS - 1);
      await settledWhileTheClockIsStopped();
      expect(said).toEqual([{ update: CAMERA_OPENED }]);

      jest.advanceTimersByTime(1);
      await seen;

      expect(photosSent).toHaveLength(0);
      expect(said).toEqual([
        { update: CAMERA_OPENED },
        { message: photoNotSent('the Jarvis server could not be reached') },
      ]);
      expect(warn).toHaveBeenCalledWith(
        `The photo for Jarvis was not sent: The Jarvis server had opened no slot ${PHOTO_SLOT_WAIT_MS / 1000} s after the camera closed.`,
      );
    } finally {
      jest.useRealTimers();
      warn.mockRestore();
    }
  });
});

describe('a photo that does not get there', () => {
  it('tells the agent, as sir’s turn, with the phone’s reason for the slot being refused', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    const { said, conversation, stillInTheConversation } = createConversation();
    const { server, photosSent } = createServer({
      slot: { problem: 'notLive', description: 'The server could not confirm the conversation.' },
    });

    await seeThePhotoThrough({
      photo: Promise.resolve(TAKEN),
      conversationId: CONVERSATION_ID,
      server,
      conversation,
      stillInTheConversation,
    });

    expect(photosSent).toHaveLength(0);
    expect(said.at(-1)).toEqual({
      message: "The photo I took didn't reach you: this conversation could not be confirmed as live.",
    });
    expect(warn).toHaveBeenCalledWith(
      'The photo for Jarvis was not sent: The server could not confirm the conversation.',
    );
    warn.mockRestore();
  });

  it('asks for no slot for a conversation with no id, and says it could not be confirmed', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    const { said, conversation, stillInTheConversation } = createConversation();
    const { server, slotsAskedFor, photosSent } = createServer();

    await seeThePhotoThrough({
      photo: Promise.resolve(TAKEN),
      conversationId: undefined,
      server,
      conversation,
      stillInTheConversation,
    });

    expect(slotsAskedFor).toHaveLength(0);
    expect(photosSent).toHaveLength(0);
    expect(said).toEqual([{ update: CAMERA_OPENED }, { message: photoNotSent(PHOTO_PROBLEMS.notLive) }]);
    warn.mockRestore();
  });

  it('tells the agent why an upload that was refused did not arrive', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    const { said, conversation, stillInTheConversation } = createConversation();
    const { server } = createServer({
      delivery: { problem: 'tooLarge', description: 'The photo was too large for the server.' },
    });

    await seeThePhotoThrough({
      photo: Promise.resolve(TAKEN),
      conversationId: CONVERSATION_ID,
      server,
      conversation,
      stillInTheConversation,
    });

    expect(said.at(-1)).toEqual({ message: "The photo I took didn't reach you: it was larger than a photo can be." });
    warn.mockRestore();
  });
});

describe('a conversation that ends while the camera is open', () => {
  it('still sends the photo, which the server keeps for later, and tells no one', async () => {
    // Routing brings a photo nobody has looked at up in a later conversation; a message sent now
    // could only land in a conversation that is not the one it was taken in.
    const { said, conversation, stillInTheConversation, end } = createConversation();
    const { server, photosSent } = createServer();
    const camera = later<CameraAnswer>();

    const seen = seeThePhotoThrough({
      photo: camera.promise,
      conversationId: CONVERSATION_ID,
      server,
      conversation,
      stillInTheConversation,
    });
    end();
    camera.settle(TAKEN);
    await seen;

    expect(photosSent).toHaveLength(1);
    expect(said).toEqual([{ update: CAMERA_OPENED }]);
  });

  it('says nothing of a camera closed after it ended', async () => {
    const { said, conversation, stillInTheConversation, end } = createConversation();
    const { server } = createServer();
    const camera = later<CameraAnswer>();

    const seen = seeThePhotoThrough({
      photo: camera.promise,
      conversationId: CONVERSATION_ID,
      server,
      conversation,
      stillInTheConversation,
    });
    end();
    camera.settle(WENT_BACK);
    await seen;

    expect(said).toEqual([{ update: CAMERA_OPENED }]);
  });

  it('says nothing of a photo that failed after it ended', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    const { said, conversation, stillInTheConversation, end } = createConversation();
    const { server } = createServer({
      delivery: { problem: 'unreachable', description: 'The Jarvis server could not be reached.' },
    });
    const camera = later<CameraAnswer>();

    const seen = seeThePhotoThrough({
      photo: camera.promise,
      conversationId: CONVERSATION_ID,
      server,
      conversation,
      stillInTheConversation,
    });
    end();
    camera.settle(TAKEN);
    await seen;

    expect(said).toEqual([{ update: CAMERA_OPENED }]);
    warn.mockRestore();
  });
});
