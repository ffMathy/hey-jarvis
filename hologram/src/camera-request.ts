/**
 * The agent's `openCamera` client tool, as far as every device that is Jarvis has to know it.
 *
 * **Only the phone has a camera**, and everything about taking and sending a photo — where it may
 * go, what the agent is told after — is the phone's, in `mobile/src/camera-answers.ts`. What is
 * shared is the tool's name, and the answer a device without a camera gives: the same agent talks to
 * the watch, and the SDK reports a tool nobody registered through `onError`, which a watch would put
 * on its face in red. So the watch answers it too, with {@link NO_CAMERA_HERE}; the voice firmware
 * spells the same answer in `elevenlabs_stream.cpp`.
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
