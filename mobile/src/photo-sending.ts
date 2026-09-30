import type { JarvisConversation } from 'hologram/conversation';
import { CAMERA_CLOSED, CAMERA_OPENED, PHOTO_PROBLEMS, photoNotSent, photoSent } from './photo-messages';
import type { PhotoDelivery, PhotoFailure, PhotoSlot } from './photo-upload';

/** The Jarvis server, as far as one photo needs it: somewhere to send it, and sending it there. */
export interface PhotoServer {
  openSlot(conversationId: string): Promise<PhotoSlot>;
  sendPhoto(photo: Blob, uploadPath: string): Promise<PhotoDelivery>;
}

/** As much of the conversation as one photo speaks into. */
export type PhotoConversation = Pick<JarvisConversation, 'sendText' | 'sendContextualUpdate'>;

/** A conversation with no ElevenLabs id to give the server is one it could never confirm as live. */
const NO_CONVERSATION_ID: PhotoFailure = {
  problem: 'notLive',
  description: 'The conversation had no ElevenLabs id to confirm it by.',
};

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
 *    rather than hanging up on the silence.
 *
 * Then, once the camera has closed:
 *
 * 3. **No photo** — sir backed out — and the agent is told so ({@link CAMERA_CLOSED}), and carries on.
 * 4. **A photo**, and it goes to the slot, and the agent is told what it was filed as
 *    ({@link photoSent}) — as sir's turn, so it acts on it now. A photo that could not be sent, or had
 *    nowhere to go, is told the same way, with a fixed phrase for why ({@link photoNotSent}), so Jarvis
 *    says so out loud rather than leaving sir waiting on it.
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
  /** The camera's answer: the photo, or `undefined` once it closed without one. */
  photo: Promise<Blob | undefined>;
  /** The conversation's ElevenLabs id as it was at the tap, if it had one. See `liveConversationId`. */
  conversationId: string | undefined;
  server: PhotoServer;
  conversation: PhotoConversation;
  /** Whether the conversation the tap was made in is still the one open, and still connected. */
  stillInTheConversation: () => boolean;
}): Promise<void> {
  const slot = conversationId === undefined ? Promise.resolve(NO_CONVERSATION_ID) : server.openSlot(conversationId);
  conversation.sendContextualUpdate(CAMERA_OPENED);

  const taken = await photo.catch(() => undefined);
  if (!taken) {
    if (stillInTheConversation()) {
      conversation.sendContextualUpdate(CAMERA_CLOSED);
    }
    return;
  }

  const opened = await slot;
  const delivery = 'uploadPath' in opened ? await server.sendPhoto(taken, opened.uploadPath) : opened;
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
