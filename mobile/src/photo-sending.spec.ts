import { describe, expect, it, spyOn } from 'bun:test';
import { CAMERA_CLOSED, CAMERA_OPENED, PHOTO_PROBLEMS, photoNotSent, photoSent } from './photo-messages';
import { type PhotoServer, seeThePhotoThrough } from './photo-sending';
import type { PhotoDelivery, PhotoSlot } from './photo-upload';

const CONVERSATION_ID = 'conv_01jz8k3b4c5d6e7f';
const UPLOAD_PATH = '/api/photos/Q2hhbmdlIG1lIHBsZWFzZQ';
const PHOTO = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });

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

/** A conversation that remembers what it was told, and a switch for whether it is still the one open. */
function createConversation() {
  const said: Said[] = [];
  let open = true;
  return {
    said,
    end: () => {
      open = false;
    },
    stillInTheConversation: () => open,
    conversation: {
      sendContextualUpdate: (text: string) => said.push({ update: text }),
      sendText: (text: string) => said.push({ message: text }),
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

describe('a tap of the camera button', () => {
  it('asks for a slot and tells the agent the camera is open before anything is awaited', () => {
    // Both in the tap itself: the slot while the conversation is certainly live, and the note so the
    // agent waits for the photo rather than hanging up on the silence.
    const { said, conversation, stillInTheConversation } = createConversation();
    const { server, slotsAskedFor } = createServer();

    void seeThePhotoThrough({
      photo: later<Blob | undefined>().promise,
      conversationId: CONVERSATION_ID,
      server,
      conversation,
      stillInTheConversation,
    });

    expect(slotsAskedFor).toEqual([CONVERSATION_ID]);
    expect(said).toEqual([{ update: CAMERA_OPENED }]);
  });

  it('sends the photo to the slot, and tells the agent what it was filed as, as sir’s turn', async () => {
    const { said, conversation, stillInTheConversation } = createConversation();
    const { server, photosSent } = createServer();
    const camera = later<Blob | undefined>();

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

    camera.settle(PHOTO);
    await seen;

    expect(photosSent).toEqual([{ photo: PHOTO, uploadPath: UPLOAD_PATH }]);
    expect(said).toEqual([{ update: CAMERA_OPENED }, { message: photoSent('photo3') }]);
  });

  it('waits for a slot still on its way when the photo is taken first', async () => {
    const { said, conversation, stillInTheConversation } = createConversation();
    const slot = later<PhotoSlot>();
    const { server, photosSent } = createServer({ slot: slot.promise });

    const seen = seeThePhotoThrough({
      photo: Promise.resolve(PHOTO),
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
      photo: Promise.resolve(undefined),
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

describe('a photo that does not get there', () => {
  it('tells the agent, as sir’s turn, with the phone’s reason for the slot being refused', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    const { said, conversation, stillInTheConversation } = createConversation();
    const { server, photosSent } = createServer({
      slot: { problem: 'notLive', description: 'The server could not confirm the conversation.' },
    });

    await seeThePhotoThrough({
      photo: Promise.resolve(PHOTO),
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
      photo: Promise.resolve(PHOTO),
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
      photo: Promise.resolve(PHOTO),
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
    const camera = later<Blob | undefined>();

    const seen = seeThePhotoThrough({
      photo: camera.promise,
      conversationId: CONVERSATION_ID,
      server,
      conversation,
      stillInTheConversation,
    });
    end();
    camera.settle(PHOTO);
    await seen;

    expect(photosSent).toHaveLength(1);
    expect(said).toEqual([{ update: CAMERA_OPENED }]);
  });

  it('says nothing of a camera closed after it ended', async () => {
    const { said, conversation, stillInTheConversation, end } = createConversation();
    const { server } = createServer();
    const camera = later<Blob | undefined>();

    const seen = seeThePhotoThrough({
      photo: camera.promise,
      conversationId: CONVERSATION_ID,
      server,
      conversation,
      stillInTheConversation,
    });
    end();
    camera.settle(undefined);
    await seen;

    expect(said).toEqual([{ update: CAMERA_OPENED }]);
  });

  it('says nothing of a photo that failed after it ended', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    const { said, conversation, stillInTheConversation, end } = createConversation();
    const { server } = createServer({
      delivery: { problem: 'unreachable', description: 'The Jarvis server could not be reached.' },
    });
    const camera = later<Blob | undefined>();

    const seen = seeThePhotoThrough({
      photo: camera.promise,
      conversationId: CONVERSATION_ID,
      server,
      conversation,
      stillInTheConversation,
    });
    end();
    camera.settle(PHOTO);
    await seen;

    expect(said).toEqual([{ update: CAMERA_OPENED }]);
    warn.mockRestore();
  });
});
