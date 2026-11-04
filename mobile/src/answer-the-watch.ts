import type { Pairing } from 'hologram';
import { useEffect } from 'react';
import { sendPairingToTheWatch, whenTheWatchAsksForCredentials } from '../modules/jarvis-watch';

/**
 * Hands the watch this phone's pairing with the Jarvis server — its address and the token the server
 * gave the phone — which the watch shares rather than pairing itself (it has no browser to sign in
 * to Cloudflare Access with). Unpairing the phone on the server therefore unpairs the watch too.
 *
 * Two moments, both without anybody tapping anything:
 *
 * - **When the watch asks**, which it does on every start it makes with none — see
 *   `watch/src/phone-settings.ts`. Only a *running* phone app can answer, because the pairing lives
 *   behind the keystore in JavaScript's hands rather than in the native module that hears the
 *   question, so this is mounted for the life of the app rather than on any one screen.
 * - **When the pairing is new** — read at launch, or the phone paired again. A watch that already
 *   has a pairing never asks, so a phone paired again with a new token would otherwise leave the
 *   watch on the old one, which the server no longer knows. A watch out of range simply misses it,
 *   and the watch card's button is there for that.
 *
 * **It does not ask permission, and that is worth being deliberate about.** What it sends is a live
 * token, and it sends it without a prompt. Three things make that the right default rather than a
 * lazy one: the only thing that can receive it is an app signed with this app's own key and
 * carrying its package name, which is Play Services' precondition for the Data Layer connecting at
 * all; the request carries no payload, so nothing about it can be forged into something else; and
 * the alternative is a dialog on the phone in answer to a gesture made on the watch, which is a
 * prompt nobody is looking at. The user's consent is that they installed Jarvis on their own watch.
 *
 * Nothing happens while the phone is not paired, which is a phone part-way through the tour. The
 * watch keeps asking on its own schedule, so there is nothing to retry here.
 */
export function useAnswerTheWatch(pairing: Pairing | undefined): void {
  useEffect(() => {
    if (!pairing) {
      return;
    }
    void sendPairingToTheWatch(pairing);
    return whenTheWatchAsksForCredentials(() => {
      void sendPairingToTheWatch(pairing);
    });
  }, [pairing]);
}
