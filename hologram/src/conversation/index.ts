/**
 * The conversation with Jarvis, for the apps that hold one.
 *
 * The package's third entry, and the split is the same argument as the other two. `hologram` is the
 * design, the voice tracking and the credentials, with nothing but type imports in it, so it runs
 * headless in the tests. `hologram/react` needs React, Reanimated and Skia for real. This one needs
 * React and **`@elevenlabs/react-native`** — and deliberately not Skia, so that a screen can hold a
 * conversation before CanvasKit has finished loading in a browser, which is precisely the case
 * `mobile/src/jarvis-hologram.web.tsx` exists to handle.
 *
 * `@elevenlabs/react-native` is a side-effect module — importing it installs the WebRTC globals and
 * registers the voice session strategy — so the app that renders these has to import it first
 * itself, at the top of its own entry. See the note at the top of `mobile/src/app.tsx`; getting it
 * wrong fails at runtime with "No voice session setup strategy registered", nowhere near the cause.
 */
export { useAgentVoice } from './agent-voice';
export { useGreeting } from './greeting';
export { useHangUpWhenQuiet } from './hang-up-when-quiet';
export { inTurn } from './in-turn';
export { useSdkVoiceReaders } from './sdk-voice-readers';
export {
  NOTHING_IN_FLIGHT,
  type ToolCallsInFlight,
  toolCallFinished,
  toolCallStarted,
  useToolActivity,
} from './tool-activity';
export { useUserVoice } from './user-voice';
