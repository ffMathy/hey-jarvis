/**
 * Showing Jarvis something: the phone's half of the agent's `openCamera` client tool — what it is
 * told, what it says, and where it may send a photo.
 *
 * **Jarvis cannot see, and neither can the agent he speaks through.** What can is a multimodal
 * model behind `routePromptWorkflow` on the Mastra server — so a photo has to get *there*, and the
 * phone knows no Mastra address and holds no Mastra secret, on purpose (see "Configuration" in
 * `mobile/AGENTS.md`). The address therefore comes from Mastra itself, one photo at a time:
 *
 * 1. The agent calls the MCP tool {@link PREPARE_PHOTO_UPLOAD_TOOL}, and Mastra answers with a
 *    single-use upload URL of its own, good for a few minutes.
 * 2. ElevenLabs relays that answer to the device as an `mcp_tool_call` event, and the device keeps
 *    the URL ({@link readOfferedUploadUrl}).
 * 3. The agent calls `openCamera` (`OPEN_CAMERA_TOOL` in `hologram`). The device opens the camera, sends the photo to the
 *    URL it kept, and answers with the id Mastra filed it under ({@link photoShown}) — or with why
 *    there is none.
 * 4. The agent asks `routePromptWorkflow` about the photo by that id.
 *
 * **The URL never passes through the model.** It could have — as a parameter of `openCamera`, copied
 * out of the MCP answer — and then anything that can put words in the model's mouth could have sent
 * sir's photo somewhere else: an email it summarised, a web page it read, the text on an earlier
 * photo. An MCP result reaches the device from ElevenLabs, not from the model, so only a URL Mastra
 * really minted is ever uploaded to. `openCamera` takes no parameters at all.
 *
 * **The agent waits; the device takes as long as sir does.** The tool is configured with
 * `expectsResponse: true` and the longest `responseTimeoutSecs` ElevenLabs allows, so the agent
 * holds the turn while the camera is open instead of hearing silence and hanging up.
 *
 * **Every answer is a sentence for the agent, never an error.** A client tool that throws reaches
 * the SDK's `onError`, which a phone shows as a failed conversation. A photo not taken, not sent or
 * not possible is an outcome, so each one is answered with what the agent should do next, in the
 * `instructions` field every tool response here carries.
 *
 * **Only a device that says it has a camera is asked.** The same agent answers the watch, the house
 * speakers and phone calls, none of which has one. So a device with a camera says so once it is
 * connected ({@link CAMERA_ON_THIS_DEVICE}), and the agent only asks where it has been told — a
 * dynamic variable would have done it too, and failed every conversation from a device that did
 * not send one. The watch answers the tool anyway, with `NO_CAMERA_HERE` from `hologram`, in case
 * it is asked — which, with the tool's name, is all of this the two devices share.
 *
 * Imports nothing, so the whole of the phone's side of the contract is a test with no SDK in it.
 * The hook that answers the tool is `camera-tool.ts`.
 */

/**
 * The MCP tool that mints the upload URL, as Mastra's MCP server names it. ElevenLabs may put its
 * integration's own prefix in front of the name it relays, so it is matched as a part of one.
 */
export const PREPARE_PHOTO_UPLOAD_TOOL = 'preparePhotoUpload';

/**
 * What a device with a camera tells the agent once the conversation is up.
 *
 * A contextual update rather than a message: it is background the agent keeps, and it neither
 * starts a turn nor interrupts one. The agent's prompt asks for the camera only where it has heard
 * this.
 */
export const CAMERA_ON_THIS_DEVICE =
  "This conversation is on sir's phone, which has a camera: preparePhotoUpload and then openCamera work here.";

/**
 * What the device says for sir when he opens the camera himself.
 *
 * A user message rather than a contextual update, because it has to start a turn: the agent is then
 * busy fetching an upload URL and waiting on the camera rather than hearing a silent room and
 * hanging up while sir frames the shot.
 */
export const SHOWING_YOU_SOMETHING =
  "(Sir has opened his phone's camera to show you something. Call preparePhotoUpload and then openCamera now.)";

/**
 * An upload URL as Mastra mints them: HTTPS, some host, the upload path and a token.
 *
 * Checked even though it comes from Mastra, because it is where sir's photo goes. A regular
 * expression rather than `URL`, because React Native's `URL` implements none of the parts it would
 * be read by.
 */
const UPLOAD_URL = /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?\/api\/photos\/[A-Za-z0-9_-]{16,64}$/;

/** How far into an MCP result to look for the URL: content parts, then the JSON inside a text part. */
const DEEPEST_LOOK = 4;

/** Every upload URL anywhere in an MCP result, wherever its envelope happens to put it. */
function uploadUrlsIn(value: unknown, depth: number): string[] {
  if (depth > DEEPEST_LOOK) {
    return [];
  }
  if (typeof value === 'string') {
    if (UPLOAD_URL.test(value)) {
      return [value];
    }
    if (!value.trim().startsWith('{')) {
      return [];
    }
    try {
      return uploadUrlsIn(JSON.parse(value), depth + 1);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => uploadUrlsIn(entry, depth + 1));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap((entry) => uploadUrlsIn(entry, depth + 1));
  }
  return [];
}

/**
 * The upload URL Mastra minted, if this `mcp_tool_call` event is `preparePhotoUpload` answering.
 *
 * Read from the event ElevenLabs relays, and never from anything the model wrote. The envelope an
 * MCP result arrives in is not pinned, so the URL is looked for rather than expected at one place —
 * the same stance the ElevenLabs test harness takes to reading routing reports.
 */
export function readOfferedUploadUrl(mcpToolCall: unknown): string | undefined {
  if (typeof mcpToolCall !== 'object' || mcpToolCall === null) {
    return undefined;
  }
  const toolName = 'tool_name' in mcpToolCall ? mcpToolCall.tool_name : undefined;
  const state = 'state' in mcpToolCall ? mcpToolCall.state : undefined;
  if (
    typeof toolName !== 'string' ||
    !toolName.toLowerCase().includes(PREPARE_PHOTO_UPLOAD_TOOL.toLowerCase()) ||
    state !== 'success' ||
    !('result' in mcpToolCall)
  ) {
    return undefined;
  }
  return uploadUrlsIn(mcpToolCall.result, 0)[0];
}

/** A tool answer: what the agent should do next, and anything it needs to do it. */
function answer(fields: Record<string, string>): string {
  return JSON.stringify(fields);
}

/** The photo is with Mastra: the agent can now ask about it by id. */
export function photoShown(photoId: string): string {
  return answer({
    photoId,
    instructions: `Sir has taken the photo, filed as ${photoId}. Call routePromptWorkflow now with what he wants to know about it and "(photo ${photoId})" — for example "What is the total on this receipt? (photo ${photoId})" — and name the photo that way in every later question about it. If he has not said, ask "What does this photo show? (photo ${photoId})". If something he asked before this is still unanswered, ask it in the same call.`,
  });
}

/** He closed the camera without taking one. */
export const NO_PHOTO_TAKEN = answer({
  instructions:
    'Sir closed the camera without taking a photo, so there is nothing to look at. Say nothing about it, and call hangUpWhenQuiet silently.',
});

/** The photo was taken and could not be sent. */
export const PHOTO_NOT_SENT = answer({
  instructions:
    'The photo was taken but could not be sent to you. Tell sir so in one short sentence, and do not try again unless he asks.',
});

/** The agent called before Mastra had minted somewhere to send the photo. */
export const NO_UPLOAD_URL = answer({
  instructions: 'There is nowhere to send a photo yet. Call preparePhotoUpload, then call openCamera again.',
});

/**
 * The agent called without somewhere to send the photo twice running: whatever carries the URL to
 * the device is not getting through, and asking again would only go round in circles.
 */
export const PHOTOS_UNAVAILABLE = answer({
  instructions:
    'Photos cannot reach you from this phone right now. Tell sir so in one short sentence, and do not call openCamera again in this conversation.',
});

/** The camera was asked for, and sir never opened it. */
export const CAMERA_NOT_OPENED = answer({
  instructions: 'Sir did not open the camera. Say nothing about it, and call hangUpWhenQuiet silently.',
});

/** A second call arrived while this one was still waiting, and the photo goes to that one. */
export const REPLACED_BY_A_LATER_CALL = answer({
  instructions: 'A later openCamera call took over from this one. Ignore this result.',
});
