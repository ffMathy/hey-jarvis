import { describe, expect, it, spyOn } from 'bun:test';
import { screenshotTaken } from './photo-messages';
import type { PhotoServer } from './photo-sending';
import type { PhotoDelivery, PhotoSlot } from './photo-upload';
import { sendTheScreenshot } from './screenshot-sending';

const CONVERSATION_ID = 'conv_01jz8k3b4c5d6e7f';
const UPLOAD_PATH = '/api/photos/Q2hhbmdlIG1lIHBsZWFzZQ';
const SCREENSHOT = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });

/** A server that answers as it is told to, and remembers what it was asked. */
function createServer({
  slot = { uploadPath: UPLOAD_PATH },
  delivery = { photoId: 'photo7' },
}: {
  slot?: PhotoSlot;
  delivery?: PhotoDelivery;
} = {}) {
  const slotsAskedFor: string[] = [];
  const sent: Array<{ photo: Blob; uploadPath: string }> = [];
  const server: PhotoServer = {
    openSlot: async (conversationId) => {
      slotsAskedFor.push(conversationId);
      return slot;
    },
    sendPhoto: async (photo, uploadPath) => {
      sent.push({ photo, uploadPath });
      return delivery;
    },
  };
  return { server, slotsAskedFor, sent };
}

/** A conversation that remembers the notes it was given, and a switch for whether it is still open. */
function createConversation() {
  const notes: string[] = [];
  let open = true;
  return {
    notes,
    end: () => {
      open = false;
    },
    stillInTheConversation: () => open,
    conversation: { sendContextualUpdate: (text: string) => notes.push(text) },
  };
}

describe('the screenshot taken when sir summoned Jarvis', () => {
  it('goes to a slot opened for the conversation, and the agent is told in a note what it was filed as', async () => {
    const { server, slotsAskedFor, sent } = createServer();
    const { notes, conversation, stillInTheConversation } = createConversation();

    await sendTheScreenshot({
      screenshot: Promise.resolve(SCREENSHOT),
      conversationId: CONVERSATION_ID,
      server,
      conversation,
      stillInTheConversation,
    });

    expect(slotsAskedFor).toEqual([CONVERSATION_ID]);
    expect(sent).toEqual([{ photo: SCREENSHOT, uploadPath: UPLOAD_PATH }]);
    expect(notes).toEqual([screenshotTaken('photo7')]);
    expect(notes[0]).toContain('(photo photo7)');
  });

  it('asks the server for nothing when the summoning came with no screenshot', async () => {
    const { server, slotsAskedFor } = createServer();
    const { notes, conversation, stillInTheConversation } = createConversation();

    await sendTheScreenshot({
      screenshot: Promise.resolve(undefined),
      conversationId: CONVERSATION_ID,
      server,
      conversation,
      stillInTheConversation,
    });

    expect(slotsAskedFor).toEqual([]);
    expect(notes).toEqual([]);
  });

  it('asks the server for nothing when the conversation has no id to confirm it by', async () => {
    const { server, slotsAskedFor } = createServer();
    const { notes, conversation, stillInTheConversation } = createConversation();

    await sendTheScreenshot({
      screenshot: Promise.resolve(SCREENSHOT),
      conversationId: undefined,
      server,
      conversation,
      stillInTheConversation,
    });

    expect(slotsAskedFor).toEqual([]);
    expect(notes).toEqual([]);
  });

  it('says nothing to the agent when the slot is refused, and sends nothing', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    const { server, sent } = createServer({
      slot: { problem: 'notLive', description: 'The server could not confirm the conversation.' },
    });
    const { notes, conversation, stillInTheConversation } = createConversation();

    await sendTheScreenshot({
      screenshot: Promise.resolve(SCREENSHOT),
      conversationId: CONVERSATION_ID,
      server,
      conversation,
      stillInTheConversation,
    });

    expect(sent).toEqual([]);
    expect(notes).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      'The screenshot for Jarvis was not sent: The server could not confirm the conversation.',
    );
    warn.mockRestore();
  });

  it('says nothing to the agent when the upload fails', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    const { server } = createServer({
      delivery: { problem: 'unreachable', description: 'The Jarvis server could not be reached.' },
    });
    const { notes, conversation, stillInTheConversation } = createConversation();

    await sendTheScreenshot({
      screenshot: Promise.resolve(SCREENSHOT),
      conversationId: CONVERSATION_ID,
      server,
      conversation,
      stillInTheConversation,
    });

    expect(notes).toEqual([]);
    warn.mockRestore();
  });

  it('is not told to a conversation that has ended by the time it is filed', async () => {
    const { server } = createServer();
    const { notes, conversation, stillInTheConversation, end } = createConversation();

    const sending = sendTheScreenshot({
      screenshot: Promise.resolve(SCREENSHOT),
      conversationId: CONVERSATION_ID,
      server,
      conversation,
      stillInTheConversation,
    });
    end();
    await sending;

    expect(notes).toEqual([]);
  });

  it('never throws, even when reading the screenshot does', async () => {
    const { server, slotsAskedFor } = createServer();
    const { notes, conversation, stillInTheConversation } = createConversation();

    await sendTheScreenshot({
      screenshot: Promise.reject(new Error('unreadable')),
      conversationId: CONVERSATION_ID,
      server,
      conversation,
      stillInTheConversation,
    });

    expect(slotsAskedFor).toEqual([]);
    expect(notes).toEqual([]);
  });
});
