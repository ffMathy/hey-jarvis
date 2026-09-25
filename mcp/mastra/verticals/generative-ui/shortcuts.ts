import { createShortcut } from '../../utils/shortcut-factory.js';
import { executeTool } from '../../utils/tool-factory.js';
import { runCodingTask } from '../coding/tools.js';
import { sendPushNotification } from '../notification/tools.js';

/**
 * Shortcuts are tools that piggy-back on other verticals' capabilities.
 *
 * Nothing in this vertical builds anything itself. The page is written by a Claude cloud session,
 * which is the coding vertical's to start, and it reaches the user's phone as a push notification,
 * which is the notification vertical's to send. What lives here is the asking: the brief a session
 * needs to turn "visualize my electricity prices" into a published page, and the reading of the
 * link it reports back.
 */

/**
 * Turns a request into the brief a Claude cloud session builds from.
 *
 * The session sees nothing but this text, and nobody is watching it work, so the brief carries
 * everything it would otherwise have asked about: that the page is opened on a phone, that it must
 * not touch a repository, and where to put the link so {@link findArtifactUrl} can find it.
 */
export function buildArtifactTask(request: string): string {
  return [
    'Build an interactive web page, published as an artifact, for this request from the user of Jarvis, a voice assistant:',
    '',
    request.trim(),
    '',
    'How to build it:',
    '- Make one self-contained page that answers the request visually: a chart, a dashboard, a diagram, an explainer or a user interface, whichever fits.',
    '- Design for a phone first. It is usually opened by tapping a push notification, so it has to read well at phone width and still work on a desktop.',
    '- Use the data given in the request. Where it needs facts that are not given and can be looked up, look them up. Never present invented numbers as real ones; label anything illustrative as such.',
    '- Nobody is there to answer questions, so do not ask any. Make sensible choices and carry on.',
    '- This is not a code change: do not modify any repository, create branches, open pull requests or file issues.',
    '',
    "Publish the page as an artifact, so it can be opened in a browser over HTTPS. End your final message with the artifact's URL alone on its last line.",
  ].join('\n');
}

/** Anything that looks like a web address, stopping at whitespace and the brackets and quotes around it. */
const URL_PATTERN = /https?:\/\/[^\s<>"'`()[\]]+/g;

/** Punctuation that ends a sentence rather than a URL. */
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

/**
 * Finds the artifact's URL in what the session reported.
 *
 * The brief asks for the URL alone on the last line, but a session that also mentions its sources
 * or wraps the link in markdown should not be taken at its first address, so the *last* one wins.
 */
export function findArtifactUrl(message: string): string | undefined {
  const candidates = message.match(URL_PATTERN) ?? [];

  for (const candidate of candidates.reverse()) {
    const trimmed = candidate.replace(TRAILING_PUNCTUATION, '');
    if (URL.canParse(trimmed)) {
      return trimmed;
    }
  }

  return undefined;
}

/**
 * Has a Claude cloud session build and publish a page for a request.
 *
 * A shortcut onto the coding vertical's `runCodingTask`: the caller says what to show, and the
 * shortcut turns that into a brief the session can work from alone. The artifact's URL is in the
 * session's `final_message`, where {@link findArtifactUrl} reads it from.
 */
export const createArtifact = createShortcut({
  id: 'createArtifact',
  description:
    "Have a Claude cloud session build an interactive web page (an artifact) for what `task` describes, publish it, and report back with its URL at the end of `final_message`. Takes a few minutes. `task` should say what to show and include any data the page needs, since the session can't reach Jarvis's own.",
  tool: runCodingTask,
  execute: async (inputData, context) =>
    await executeTool(runCodingTask, { task: buildArtifactTask(inputData.task) }, context),
});

/**
 * Pushes an artifact to the user's phone, so a tap opens it.
 *
 * A shortcut onto the notification vertical's `sendPushNotification`. The push is the right
 * channel whatever the user is doing: a link is no use read out loud, and a page is something to
 * look at when there is a moment, not something to interrupt a room with.
 */
export const openArtifactOnPhone = createShortcut({
  id: 'openArtifactOnPhone',
  description:
    "Send a push notification to the primary user's phone that opens an artifact's URL in the phone's browser when tapped. `url` is required: it is the artifact to open.",
  tool: sendPushNotification,
  execute: async (inputData, context) => {
    if (!inputData.url?.trim()) {
      throw new Error("openArtifactOnPhone needs the artifact's url, which is what tapping the notification opens.");
    }

    return await executeTool(sendPushNotification, inputData, context);
  },
});

export const generativeUiShortcuts = {
  createArtifact,
  openArtifactOnPhone,
};
