/**
 * The name the app is registered under for the assistant's own window.
 *
 * Summoned, Jarvis is not launched: `JarvisVoiceInteractionSession` renders the app into the
 * window the system draws over whatever was already on screen, as a second React Native surface on
 * the instance already running. A surface is started by name, so the app registers itself twice —
 * once as `main`, the way any app does, and once under this name, which differs only in that the
 * app is told it was summoned.
 *
 * This has to stay in step with `MAIN_COMPONENT` in `JarvisVoiceInteractionSession.kt`. There is no
 * way to share a constant across that boundary, so `assistant-window.contract.spec.ts` reads both
 * out of the sources and fails if they disagree — drift here would leave the assistant gesture
 * opening a window with nothing in it.
 */
export const ASSISTANT_SURFACE = 'assistant';

/**
 * The root prop the session sets on that surface every time its window is shown, to a number that
 * differs each time.
 *
 * The window is kept between summonings rather than rebuilt, so a summoning after the first finds
 * the app already mounted in it and has to be told. `AppState` looked like the way to tell it, and
 * is not: it belongs to the process, and the process may also be drawing the app's own activity
 * from an earlier launch, sitting behind whatever the user is doing. That tree heard every
 * summoning as well, and answered it with a conversation nobody could see. A prop on this surface
 * reaches this surface's tree and no other.
 *
 * Spelled `SHOWING_PROP` in `JarvisVoiceInteractionSession.kt` too, and pinned to it by
 * `assistant-window.contract.spec.ts`.
 */
export const SHOWING_PROP = 'showing';
