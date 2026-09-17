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
