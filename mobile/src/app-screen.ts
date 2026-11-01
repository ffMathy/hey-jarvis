import type { Glance } from 'hologram';

/** Which screen the app is showing. */
export type Screen = 'loading' | 'sample' | 'onboarding' | 'settings' | 'glance' | 'conversation';

/** Everything that has a say in which screen shows. */
export interface ScreenState {
  isLoaded: boolean;
  /** Whether the glance kept from before has been read (`glance-storage.ts`), as the settings have. */
  isGlanceRead: boolean;
  hasSettings: boolean;
  isEditingSettings: boolean;
  isSampling: boolean;
  isTouring: boolean;
  /** Summoned — by the assistant gesture, or the plain assist intent — rather than opened. */
  wasSummoned: boolean;
  /** The glance to show, if there is one (see {@link glanceToShow}). */
  glance: Glance | undefined;
  /** Sir asked to talk to Jarvis from the glance, and that conversation has not ended. */
  wantsToTalk: boolean;
  /** A conversation already on screen is under way, and is not to be taken away from him. */
  conversationUnderWay: boolean;
}

/**
 * Which one, given everything that has a say in it.
 *
 * The order is the argument. Sample mode comes first because it is a side trip taken *from*
 * somewhere and returned to — including from the tour, where it is offered on every step. The tour
 * comes next because a first run has nothing else worth showing. The bare settings screen is what
 * is left for an install that has been through the tour and has no credentials any more, which is
 * where this app opened before there was a tour at all.
 *
 * **Opened rather than summoned, it is the glance**, when the server has sent one: the page it made
 * ahead of time for sir to look at. Summoned, it is always him — someone who made the assistant
 * gesture asked for Jarvis. And never in the middle of a conversation: a glance that arrives while
 * one is under way waits for it to end, rather than taking Jarvis away mid-sentence. With no glance —
 * no server, or none sent yet — it is the conversation, exactly as it was before there were glances.
 */
export function chooseScreen(state: ScreenState): Screen {
  if (!state.isLoaded || !state.isGlanceRead) return 'loading';
  if (state.isSampling) return 'sample';
  if (state.isTouring) return 'onboarding';
  if (!state.hasSettings || state.isEditingSettings) return 'settings';
  if (state.wasSummoned || state.glance === undefined || state.wantsToTalk || state.conversationUnderWay) {
    return 'conversation';
  }
  return 'glance';
}

/**
 * How long a glance is shown after the server made it: three hours, as long as the server itself
 * keeps one current (`GLANCE_MAX_AGE_MS` in `mcp/mastra/verticals/visualize/glance.ts`). A glance is
 * about the moment it was made in — the parcel due this afternoon — and one kept on the phone from a
 * server that has since gone quiet should not go on offering to unlock the door for it tomorrow.
 */
export const GLANCE_SHOWN_FOR_MS = 3 * 60 * 60 * 1000;

/**
 * The glance to show: the line's latest, or else the one kept from before (`glance-storage.ts`), and
 * only one made within {@link GLANCE_SHOWN_FOR_MS} before `now` — and only while there is a server to
 * have sent it, since its actions go nowhere without one.
 */
export function glanceToShow({
  live,
  kept,
  hasServer,
  now,
}: {
  live: Glance | undefined;
  kept: Glance | undefined;
  hasServer: boolean;
  now: number;
}): Glance | undefined {
  if (!hasServer) return undefined;
  const glance = live ?? kept;
  if (glance === undefined) return undefined;
  const age = now - Date.parse(glance.generatedAt);
  return age <= GLANCE_SHOWN_FOR_MS ? glance : undefined;
}
