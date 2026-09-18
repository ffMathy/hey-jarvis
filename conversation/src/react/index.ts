/**
 * The half of the conversation that needs React and the ElevenLabs SDK.
 *
 * Kept apart from the package's main entry for the reason `hologram/react` is: that entry is plain
 * TypeScript over `fetch`, so the tests drive it with no SDK and no device, and this one calls
 * into `@elevenlabs/react-native` for real. Import `conversation` for the credentials and the
 * token; import `conversation/react` for the hooks a screen holding one needs.
 *
 * `@elevenlabs/react-native` is a side-effect module — importing it installs the WebRTC globals
 * and registers the voice session strategy — so the app that renders these has to import it first
 * itself, at the top of its entry. See the note at the top of `mobile/src/app.tsx`.
 */
export { useAgentVoice } from './agent-voice';
export { useSdkVoiceReaders } from './sdk-voice-readers';
export {
  NOTHING_IN_FLIGHT,
  type ToolCallsInFlight,
  toolCallFinished,
  toolCallStarted,
  useToolActivity,
} from './tool-activity';
