import type { JarvisConversation } from 'hologram/conversation';
import { CAMERA_CLOSED, CAMERA_OPENED, PHOTO_PROBLEMS, photoNotSent, photoSent } from './photo-messages';
import { PHOTO_SLOT_WAIT_MS, type PhotoDelivery, type PhotoFailure, type PhotoSlot } from './photo-upload';
import type { CameraAnswer } from './platform-contracts';

/** The Jarvis server, as far as one photo needs it: somewhere to send it, and sending it there. */
export interface PhotoServer {
  openSlot(conversationId: string): Promise<PhotoSlot>;
  sendPhoto(photo: Blob, uploadPath: string): Promise<PhotoDelivery>;
}

/** As much of the conversation as one photo speaks into. */
export type PhotoConversation = Pick<JarvisConversation, 'sendText' | 'sendContextualUpdate' | 'sendUserActivity'>;

/** A conversation with no ElevenLabs id to give the server is one it could never confirm as live. */
const NO_CONVERSATION_ID: PhotoFailure = {
  problem: 'notLive',
  description: 'The conversation had no ElevenLabs id to confirm it by.',
};

/** A camera that failed outright took no photo, as far as anyone waiting on one is concerned. */
const CLOSED: CameraAnswer = { closed: true };

/** A photo sir took or picked that could not be read as one, so there was nothing to send. */
const NOT_READABLE: PhotoFailure = {
  problem: 'notReadable',
  description: 'The photo that was taken could not be read as one.',
};

/** No slot yet, {@link PHOTO_SLOT_WAIT_MS} after the camera closed. */
const NO_SLOT_IN_TIME: PhotoFailure = {
  problem: 'unreachable',
  description: `The Jarvis server had opened no slot ${PHOTO_SLOT_WAIT_MS / 1000} s after the camera closed.`,
};

/**
 * The slot, waited on for no more than {@link PHOTO_SLOT_WAIT_MS} from now — the camera closing.
 *
 * Its request gives itself up in that time too, but counted from the tap, on JavaScript's timers,
 * which stop while the app is behind the camera app — and whether a request settles at all is the
 * server's to keep (`openPhotoSlot`), not something this flow can see. So the flow keeps a deadline of
 * its own, from the moment there is a photo: a slot that never came is then a server that could not
 * be reached, and the tap still ends in one thing said.
 */
async function slotInTime(slot: Promise<PhotoSlot>): Promise<PhotoSlot> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const tooLate = new Promise<PhotoSlot>((resolve) => {
    deadline = setTimeout(() => resolve(NO_SLOT_IN_TIME), PHOTO_SLOT_WAIT_MS);
  });
  try {
    return await Promise.race([slot, tooLate]);
  } finally {
    clearTimeout(deadline);
  }
}

/** The photo sent to the slot, once there is one, or why it could not be. */
async function sendToTheSlot(photo: Blob, slot: Promise<PhotoSlot>, server: PhotoServer): Promise<PhotoDelivery> {
  const opened = await slotInTime(slot);
  return 'uploadPath' in opened ? server.sendPhoto(photo, opened.uploadPath) : opened;
}

/**
 * One tap of the camera button, from the camera opening to Jarvis hearing how it went.
 *
 * Called in the tap itself, once the camera has been asked for (`photo`), and everything before its
 * first `await` happens there and then:
 *
 * 1. **The slot is asked for at once**, with the conversation's id, while the conversation is
 *    certainly live — the call may drop while sir frames the shot, and the slot, which lives for
 *    minutes, outlives that. With no id to give, there is no slot to ask for.
 * 2. **The agent is told the camera is open** ({@link CAMERA_OPENED}), in the background, so it waits
 *    rather than hanging up on the silence — and **sir's activity is reported** (`user_activity`)
 *    there and then, rather than first when the hook's heartbeat comes round five seconds later, by
 *    which time the agent may already have been asked to speak again. Whether ElevenLabs lets that
 *    hold anything off is not documented; see `use-photo-sending.ts`.
 *
 * Then, once the camera has closed:
 *
 * 3. **No photo** — sir backed out — and the agent is told so ({@link CAMERA_CLOSED}), and carries on.
 * 4. **A photo**, and it goes to the slot — waited on for {@link PHOTO_SLOT_WAIT_MS} at most, if it is
 *    still on its way — and the agent is told what it was filed as ({@link photoSent}), as sir's turn,
 *    so it acts on it now. A photo that could not be read, could not be sent, or had nowhere to go is
 *    told the same way, with a fixed phrase for why ({@link photoNotSent}), so Jarvis says so out loud
 *    rather than leaving sir waiting on it.
 *
 * **A photo is sent even if the conversation it was taken in has ended.** The server keeps it as one
 * nobody has looked at yet, and routing brings it up in a later conversation. What is never done is
 * telling a later conversation about it: `stillInTheConversation` is asked before every word after the
 * first, and once it says no, nothing more is said anywhere.
 *
 * Never throws: every outcome is something to tell the agent, and the phone's log is told why in the
 * phone's own words, never the server's.
 */
export async function seeThePhotoThrough({
  photo,
  conversationId,
  server,
  conversation,
  stillInTheConversation,
}: {
  /** The camera's answer: the photo, a camera closed without one, or a photo that could not be read. */
  photo: Promise<CameraAnswer>;
  /** The conversation's ElevenLabs id as it was at the tap, if it had one. See `liveConversationId`. */
  conversationId: string | undefined;
  server: PhotoServer;
  conversation: PhotoConversation;
  /** Whether the conversation the tap was made in is still the one open, and still connected. */
  stillInTheConversation: () => boolean;
}): Promise<void> {
  const slot = conversationId === undefined ? Promise.resolve(NO_CONVERSATION_ID) : server.openSlot(conversationId);
  conversation.sendContextualUpdate(CAMERA_OPENED);
  conversation.sendUserActivity();

  const answer = await photo.catch(() => CLOSED);
  if ('closed' in answer) {
    if (stillInTheConversation()) {
      conversation.sendContextualUpdate(CAMERA_CLOSED);
    }
    return;
  }

  const delivery = 'photo' in answer ? await sendToTheSlot(answer.photo, slot, server) : NOT_READABLE;
  if ('photoId' in delivery) {
    if (stillInTheConversation()) {
      conversation.sendText(photoSent(delivery.photoId));
    }
    return;
  }

  // The description is the phone's own words, never the response's.
  console.warn(`The photo for Jarvis was not sent: ${delivery.description}`);
  if (stillInTheConversation()) {
    conversation.sendText(photoNotSent(PHOTO_PROBLEMS[delivery.problem]));
  }
}
