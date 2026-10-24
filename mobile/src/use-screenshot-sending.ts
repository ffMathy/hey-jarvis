import type { JarvisConversation } from 'hologram/conversation';
import { useEffect, useRef } from 'react';
import { openPhotoSlot, sendPhoto } from './photo-upload';
import { sendTheScreenshot } from './screenshot-sending';
import { readSummoningScreenshot } from './summoning-screenshot';

/** As much of the screen's conversation (`useJarvisSession`) as the screenshot uses. */
export type ScreenshotSendingConversation = Pick<
  JarvisConversation,
  'status' | 'sendContextualUpdate' | 'liveConversationId'
>;

/**
 * Lets Jarvis see what sir was looking at when he summoned him.
 *
 * **Every summoning from the assistant gesture comes with a screenshot**, which the system hands the
 * assistant's window (`SummoningScreenshot.kt`). Once the conversation that summoning opened has
 * connected, it goes to sir's Jarvis server, kept there as a screenshot beside his photos, and the
 * agent is told — in a note that takes no turn — what it was filed as (`screenshot-sending.ts`). Nothing
 * looks at it until sir asks about something on his screen: "what does this say?" is routed with it
 * named, as a question about a photo is, and otherwise the server lets go of it after a day, or sooner
 * once enough later summonings have sent theirs.
 *
 * **Only in the assistant's window, and only with a server.** The app opened from the launcher, the
 * watch and the browser were not summoned over anything; and without an address there is nowhere to
 * send it, so the agent is told nothing. Once per conversation: the window coming back after the camera
 * is the same conversation, and the same screen.
 *
 * Called after the screen's session (`useJarvisSession` in `hologram`), with its conversation.
 */
export function useScreenshotSending({
  inAssistantWindow,
  serverAddress,
  conversation: { status, sendContextualUpdate, liveConversationId },
}: {
  inAssistantWindow: boolean;
  /** The Jarvis server's origin, or `undefined` when sir has not given this phone one. See `jarvis-server.ts`. */
  serverAddress: string | undefined;
  /** The conversation the screenshot is for: its status, its id, and the note it is told with. */
  conversation: ScreenshotSendingConversation;
}): void {
  /** Which conversation the screenshot belongs to: moved on every time one ends. */
  const conversationNumber = useRef(0);
  /** The conversation it has been sent for, so it goes once however often this effect runs. */
  const sentFor = useRef<number | undefined>(undefined);

  const connected = status === 'connected';

  useEffect(() => {
    if (!connected) {
      conversationNumber.current += 1;
      return;
    }
    const takenFor = conversationNumber.current;
    if (!inAssistantWindow || serverAddress === undefined || sentFor.current === takenFor) {
      return;
    }
    sentFor.current = takenFor;

    void sendTheScreenshot({
      screenshot: readSummoningScreenshot(),
      conversationId: liveConversationId(),
      server: {
        openSlot: (conversationId) => openPhotoSlot({ serverAddress, conversationId, kind: 'screenshot' }),
        sendPhoto: (taken, uploadPath) => sendPhoto({ serverAddress, uploadPath, photo: taken }),
      },
      conversation: { sendContextualUpdate },
      stillInTheConversation: () => takenFor === conversationNumber.current,
    });
  }, [connected, inAssistantWindow, serverAddress, liveConversationId, sendContextualUpdate]);
}
