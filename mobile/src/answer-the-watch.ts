import type { ElevenLabsSettings } from 'conversation';
import { useEffect } from 'react';
import { sendSettingsToTheWatch, whenTheWatchAsksForCredentials } from '../modules/jarvis-watch';

/**
 * Answers the watch when it asks for the ElevenLabs credentials.
 *
 * The watch asks on every start it makes with none — see `watch/src/phone-settings.ts` — and only
 * a *running* phone app can answer, because the credentials live behind the keystore in
 * JavaScript's hands rather than in the native module that hears the question. So this is mounted
 * for the life of the app rather than on any one screen: whichever screen is showing, a watch that
 * asks while the phone is open gets an answer without anybody tapping anything.
 *
 * **It does not ask permission, and that is worth being deliberate about.** What it sends is a live
 * API key, and it sends it without a prompt. Three things make that the right default rather than a
 * lazy one: the only thing that can ask is an app signed with this app's own key and carrying its
 * package name, which is Play Services' precondition for the Data Layer connecting at all; the
 * request carries no payload, so nothing about it can be forged into something else; and the
 * alternative is a dialog on the phone in answer to a gesture made on the watch, which is a prompt
 * nobody is looking at. The user's consent is that they installed Jarvis on their own watch.
 *
 * Nothing happens while there are no credentials to send, which is a phone part-way through the
 * tour. The watch keeps asking on its own schedule, so there is nothing to retry here.
 */
export function useAnswerTheWatch(settings: ElevenLabsSettings | undefined): void {
  useEffect(() => {
    if (!settings) {
      return;
    }
    return whenTheWatchAsksForCredentials(() => {
      void sendSettingsToTheWatch(settings);
    });
  }, [settings]);
}
