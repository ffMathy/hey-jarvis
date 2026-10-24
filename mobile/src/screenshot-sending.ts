import type { JarvisConversation } from 'hologram/conversation';
import { screenshotTaken } from './photo-messages';
import type { PhotoServer } from './photo-sending';

/** As much of the conversation as the screenshot speaks into: one note, which takes no turn. */
export type ScreenshotConversation = Pick<JarvisConversation, 'sendContextualUpdate'>;

/**
 * What was on sir's screen when he summoned Jarvis, from the phone to his Jarvis server, and the agent
 * told what it was filed as.
 *
 * Started once the conversation the summoning opened has connected, with its id, which the server
 * asks ElevenLabs about before it opens a slot — the same check, the same slot and the same upload as
 * a photo's (`photo-upload.ts`), with the slot asked for as a screenshot's, so the server never brings
 * it up as a photo nobody has looked at. The agent is told with a contextual update
 * ({@link screenshotTaken}), not a turn: sir has asked nothing about his screen, and the prompt has
 * the agent route a question about it only when he does.
 *
 * **Every failure is silent.** Nobody asked for it, so nobody is waiting to hear what became of it:
 * no screenshot, no server, a slot refused, an upload that failed — each is a line in the phone's log,
 * in its own words, and Jarvis is simply not told there is a screen to look at.
 *
 * Never throws, and says nothing once `stillInTheConversation` says no.
 */
export async function sendTheScreenshot({
  screenshot,
  conversationId,
  server,
  conversation,
  stillInTheConversation,
}: {
  /** The summoning's screenshot, or `undefined` when there is none. */
  screenshot: Promise<Blob | undefined>;
  /** The conversation's ElevenLabs id, if it has one. See `liveConversationId`. */
  conversationId: string | undefined;
  server: PhotoServer;
  conversation: ScreenshotConversation;
  /** Whether the conversation it was taken for is still the one open, and still connected. */
  stillInTheConversation: () => boolean;
}): Promise<void> {
  const taken = await screenshot.catch(() => undefined);
  if (taken === undefined || conversationId === undefined) {
    return;
  }

  const slot = await server.openSlot(conversationId);
  const delivery = 'uploadPath' in slot ? await server.sendPhoto(taken, slot.uploadPath) : slot;
  if (!('photoId' in delivery)) {
    // The description is the phone's own words, never the response's.
    console.warn(`The screenshot for Jarvis was not sent: ${delivery.description}`);
    return;
  }
  if (stillInTheConversation()) {
    conversation.sendContextualUpdate(screenshotTaken(delivery.photoId));
  }
}
