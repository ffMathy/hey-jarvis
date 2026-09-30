/**
 * The agent's `openCamera` client tool, as far as every device that is Jarvis has to know it.
 *
 * **Only the phone has a camera**, and everything about taking and sending a photo — where it may
 * go, what the agent is told after — is the phone's, in `mobile/src/camera-answers.ts`. What is
 * shared is the tool's name, and the answer a device without a camera gives: the same agent talks to
 * the watch and the headset, and the SDK answers a tool nobody registered with an error in its own
 * words, which gives the agent nothing to tell sir. So the session every device holds answers it
 * with {@link NO_CAMERA_HERE} wherever it is handed no client tools of its own (`jarvis-session.ts`);
 * the voice firmware spells the same answer in `elevenlabs_stream.cpp`.
 *
 * Kept free of imports like the rest of this entry.
 */

/**
 * The client tool the agent calls to see something.
 *
 * The one spelling on this side of the contract; the agent's own configuration names the same tool.
 */
export const OPEN_CAMERA_TOOL = 'openCamera';

/** A tool answer: what the agent should do next, and anything it needs to do it. */
function answer(fields: Record<string, string>): string {
  return JSON.stringify(fields);
}

/** A device with no camera was asked anyway. */
export const NO_CAMERA_HERE = answer({
  instructions: 'This device has no camera. Tell sir he can show you things from his phone.',
});
