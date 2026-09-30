import type { EchoCanceller } from './echo-canceller';

/**
 * Where his voice comes from, and why: from where he stands, or from the headset.
 *
 * Three tiers, safest last:
 *
 * 1. **`spatial`** — his voice goes through a panner at his centre and the listener follows the
 *    head, so it comes from where he stands. Only when the headset's own echo canceller is there
 *    (`echo-canceller.ts`), because only that one keeps a voice played through Web Audio out of the
 *    microphone.
 * 2. **`element`** — the SDK's own `<audio>` element plays him, from the headset, as it always did:
 *    what the browser's echo canceller knows to subtract.
 * 3. **Half duplex** — the session's fallback (`half-duplex.ts` in `hologram`), which mutes the
 *    microphone while he speaks. It is not a route of this file's: it is what the element tier
 *    turns into when the echo carries on there, and the session decides it.
 *
 * A demotion only ever goes down, and it lasts for as long as the page does: a headset whose echo
 * canceller let his spatial voice back in once will do it again, and a conversation cut short by
 * his own voice is worse than one heard from the headset. Reloading the page tries again.
 */

export type VoiceRoute = 'spatial' | 'element';

/** What moves his voice from where he stands back to the headset, once it has been seen. */
export type VoiceDemotion =
  /** Cut off within moments of starting to speak: his first syllables came back. */
  | 'echo-early-interruption'
  /** Cut off twice with nothing said by the user in between. */
  | 'echo-unexplained-interruptions'
  /** A transcript of the user that repeats what he had just said. */
  | 'echo-transcript'
  /** The AudioContext he is played through has stopped, so nothing of him would be heard. */
  | 'context-not-running'
  /** LiveKit's server hears him speaking and nothing comes through the panner. */
  | 'spatial-silent';

export type VoiceRouteReason =
  /** Spatial: the headset cancels echo itself. */
  | 'platform-echo-canceller'
  /** Spatial: `?voice=spatial` asked for it whatever the probe said. */
  | 'forced'
  /** Element: "His voice from where he stands" is switched off on the page. */
  | 'setting-off'
  /** Element: only the browser's echo canceller, which cannot hear Web Audio. */
  | 'browser-echo-canceller'
  /** Element: the browser does not say which echo canceller there is. */
  | 'echo-canceller-unknown'
  /** Element: this browser has no panner or listener to place him with. */
  | 'no-web-audio'
  | VoiceDemotion;

/** What the route is chosen from when a room opens. */
export interface VoiceRouteChoice {
  /** The page's "His voice from where he stands": off forces the element. */
  setting: boolean;
  /** `?voice=spatial`: try it whatever the probe said, to hear it on a headset. */
  forced: boolean;
  /** What the wake word's microphone says about the echo canceller. */
  echoCanceller: EchoCanceller;
  /** Whether this browser has a panner and a listener with positions to move. */
  webAudio: boolean;
}

/**
 * How long after his voice has moved to the headset the half-duplex fallback waits before
 * judging an interruption. The browser's echo canceller had a reference of silence while he was
 * spatial and needs a few seconds to settle on the real one; the research puts it at two to five.
 */
export const SETTLE_AFTER_MOVING_MS = 3_000;

/** The route a room starts with, before anything has been heard. */
export function chooseVoiceRoute(choice: VoiceRouteChoice): { route: VoiceRoute; reason: VoiceRouteReason } {
  // The user's own "off" wins over everything, the flag for trying it included.
  if (!choice.setting) return { route: 'element', reason: 'setting-off' };
  if (!choice.webAudio) return { route: 'element', reason: 'no-web-audio' };
  if (choice.forced) return { route: 'spatial', reason: 'forced' };
  switch (choice.echoCanceller) {
    case 'platform':
      return { route: 'spatial', reason: 'platform-echo-canceller' };
    case 'browser':
      return { route: 'element', reason: 'browser-echo-canceller' };
    case 'unknown':
      return { route: 'element', reason: 'echo-canceller-unknown' };
  }
}

/** The route in words for the `?debug` HUD. */
export function describeVoiceRouteReason(reason: VoiceRouteReason): string {
  switch (reason) {
    case 'platform-echo-canceller':
      return 'the headset cancels echo';
    case 'forced':
      return 'forced by ?voice=spatial';
    case 'setting-off':
      return 'switched off on the page';
    case 'browser-echo-canceller':
      return 'only the browser cancels echo';
    case 'echo-canceller-unknown':
      return 'echo canceller unknown';
    case 'no-web-audio':
      return 'no panner in this browser';
    case 'echo-early-interruption':
      return 'echo: cut off as he started';
    case 'echo-unexplained-interruptions':
      return 'echo: cut off twice, nothing said';
    case 'echo-transcript':
      return 'echo: he heard himself';
    case 'context-not-running':
      return 'audio context stopped';
    case 'spatial-silent':
      return 'silent through the panner';
  }
}

export interface VoiceRouter {
  readonly route: VoiceRoute;
  readonly reason: VoiceRouteReason;
  /** Chooses again for a new room. A demotion already seen on this page still stands. */
  choose(choice: VoiceRouteChoice): void;
  /** Moves his voice to the headset for good, if it was spatial. Says whether it moved. */
  demote(reason: VoiceDemotion): boolean;
  /**
   * Whether the half-duplex fallback may judge an interruption now: never while he is spatial
   * (an echo there demotes him first), and not until {@link SETTLE_AFTER_MOVING_MS} after moving.
   */
  halfDuplexMayJudge(): boolean;
}

export function createVoiceRouter(now: () => number, choice: VoiceRouteChoice): VoiceRouter {
  let demotion: VoiceDemotion | undefined;
  let route: VoiceRoute = 'element';
  let reason: VoiceRouteReason = 'setting-off';
  let movedAt = Number.NEGATIVE_INFINITY;

  const choose = (next: VoiceRouteChoice) => {
    const chosen = chooseVoiceRoute(next);
    if (chosen.route === 'spatial' && demotion !== undefined) {
      route = 'element';
      reason = demotion;
      return;
    }
    route = chosen.route;
    reason = chosen.reason;
  };
  choose(choice);

  return {
    get route() {
      return route;
    },
    get reason() {
      return reason;
    },
    choose,
    demote: (why) => {
      if (route !== 'spatial') return false;
      demotion = why;
      route = 'element';
      reason = why;
      movedAt = now();
      return true;
    },
    halfDuplexMayJudge: () => route === 'element' && now() - movedAt >= SETTLE_AFTER_MOVING_MS,
  };
}
