import type { Glance, ServerLink } from 'hologram';
import { useGlance } from 'hologram/react/lifecycle';
import { useCallback, useEffect, useState } from 'react';
import { glanceToShow } from './app-screen';
import { loadGlance, saveGlance } from './glance-storage';

/**
 * The glance the app opens on, and what decides whether it is showing (`chooseScreen` in
 * `app-screen.ts`): the line's latest glance, kept so the next opening has it at once
 * (`glance-storage.ts`) — or the one kept from before, until the line sends its own — whether sir
 * asked to talk from it, and whether a conversation on screen is under way.
 *
 * `read` is false until the kept glance has been read, which the app waits for as it waits for its
 * settings: deciding without it would open the conversation, greeting and all, a moment before the
 * glance arrived to replace it.
 */
export function useOpeningGlance(serverLink: ServerLink | undefined, serverAddress: string | undefined) {
  const live = useGlance(serverLink);
  const [kept, setKept] = useState<Glance | undefined>(undefined);
  const [read, setRead] = useState(false);
  const [wantsToTalk, setWantsToTalk] = useState(false);
  const [conversationUnderWay, setConversationUnderWay] = useState(false);

  useEffect(() => {
    let wanted = true;
    void loadGlance().then((stored) => {
      if (wanted) {
        setKept(stored);
        setRead(true);
      }
    });
    return () => {
      wanted = false;
    };
  }, []);

  useEffect(() => {
    if (live !== undefined) void saveGlance(live);
  }, [live]);

  const startTalking = useCallback(() => setWantsToTalk(true), []);
  /** The conversation sir asked for has ended: he goes back to the glance, if there is one. */
  const conversationOver = useCallback(() => setWantsToTalk(false), []);
  /** Sir asked for the glance back, whatever the conversation was doing. */
  const backToGlance = useCallback(() => {
    setWantsToTalk(false);
    setConversationUnderWay(false);
  }, []);

  const glance = glanceToShow({ live, kept, hasServer: serverAddress !== undefined, now: Date.now() });
  return {
    glance,
    read,
    wantsToTalk,
    conversationUnderWay,
    setConversationUnderWay,
    startTalking,
    conversationOver,
    backToGlance,
  };
}
