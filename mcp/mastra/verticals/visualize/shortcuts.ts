import type { GlanceAction } from '../../utils/live-events.js';
import { createShortcut } from '../../utils/shortcut-factory.js';
import { executeTool } from '../../utils/tool-factory.js';
import type { ClaudeCodeModel } from '../coding/claude-code-host.js';
import { runCodingTask } from '../coding/tools.js';
import { sendPushNotification } from '../notification/tools.js';
import { GLANCE_BRIDGE } from './glance-bridge.js';

/**
 * Shortcuts are tools that piggy-back on other verticals' capabilities.
 *
 * Nothing in this vertical builds anything itself. The page is written by a Claude Code session,
 * which is the coding vertical's to start, and it reaches the user's phone as a push notification,
 * which is the notification vertical's to send. What lives here is the asking: the brief a session
 * needs to turn "visualize my electricity prices" into a page, and the reading of the page it
 * reports back.
 */

/**
 * Turns a request into the brief a Claude Code session builds from.
 *
 * The session sees nothing but this text, and nobody is watching it work, so the brief carries
 * everything it would otherwise have asked about: that the page is opened on a phone, that it must
 * not touch a repository, and that the page itself is its answer. The session has nowhere to
 * publish to, so it hands the HTML back and the server hosts it (see `artifact-hosting.ts`).
 */
export function buildArtifactTask(request: string, options: ArtifactBriefOptions = {}): string {
  return [
    'Build an interactive web page for this request from the user of Jarvis, a voice assistant:',
    '',
    request.trim(),
    '',
    'How to build it:',
    '- Make one self-contained HTML page that answers the request visually: a chart, a dashboard, a diagram, an explainer or a user interface, whichever fits.',
    '- Keep the CSS and JavaScript inline. Libraries may be loaded from cdnjs.cloudflare.com or cdn.jsdelivr.net; nothing else can be served next to the page.',
    ...(options.glance ? glanceDesignLines(options.glance.actions) : [PUSHED_PAGE_DESIGN_LINE]),
    '- Use the data given in the request. Where it needs facts that are not given and can be looked up, look them up. Never present invented numbers as real ones; label anything illustrative as such.',
    '- Nobody is there to answer questions, so do not ask any. Make sensible choices and carry on.',
    '- This is not a code change: do not modify any repository, create branches, open pull requests or file issues.',
    '- Do not try to publish or host the page, and do not make up a link to it: Jarvis hosts it for you.',
    '',
    'End your final message with the complete HTML document, from <!doctype html> to </html>, in a single ```html code block, with nothing after it.',
  ].join('\n');
}

/** What changes in the brief for a page that is not an answer to a request. */
export interface ArtifactBriefOptions {
  /**
   * The page is sir's glance (`glance.ts`): what the phone shows when he opens Jarvis from the
   * launcher, with a button for each of `actions`.
   */
  glance?: { actions: GlanceAction[] };
}

/** How an ordinary page is designed: for the phone a push notification opens it on. */
const PUSHED_PAGE_DESIGN_LINE =
  '- Design for a phone first. It is usually opened by tapping a push notification, so it has to read well at phone width and still work on a desktop.';

/**
 * How a glance is designed, and how its buttons work.
 *
 * The buttons may only name the actions the server planned, through the bridge the server puts in
 * the page (`glance-bridge.ts`): a page that reached Home Assistant itself would need a credential
 * it must never have, and one that invented an action would offer something nobody planned.
 */
function glanceDesignLines(actions: GlanceAction[]): string[] {
  const { actFunction, resultEvent } = GLANCE_BRIDGE;
  const actionLines =
    actions.length === 0
      ? [
          '- This glance has no actions: render no buttons that do anything, and offer nothing to be done from the page.',
        ]
      : [
          `- Render one button per action below, labelled with its label. Clicking it must call \`${actFunction}('<id>')\` with exactly the id given, and nothing else: \`${actFunction}\` is provided by the page's host, so never define, replace or stub it.`,
          `- Show each button's outcome on the button itself: a working state from the click, then the result. The result arrives as \`window.addEventListener('${resultEvent}', (event) => …)\`, where \`event.detail\` is \`{ actionId, ok, message }\`; show \`message\`, styled as success when \`ok\` is true and as a failure otherwise, and let the button be pressed again after a failure.`,
          '- Never carry out an action any other way: no fetch or other request to Home Assistant or anywhere else, no links or forms that perform one, and no buttons for actions that are not listed.',
          '- The actions, as id, label and what it does:',
          ...actions.map((action) => `  - \`${action.id}\` — "${action.label}": ${action.prompt}`),
        ];

  return [
    "- This page is sir's glance: what his phone shows when he opens Jarvis from the launcher, held in the hand. Design for a phone at portrait width only, filling the full height of the screen.",
    '- Match Jarvis: a near-black background (around #05080c) with a single cyan accent (around #38e1ff), light text, and generous touch targets. Keep it calm and quick to read at a glance.',
    '- It is not a notification and not an answer to a question: never frame it as "you have a new…" or "here is what you asked for". It is simply what matters to him right now.',
    ...actionLines,
  ];
}

/**
 * Has a Claude Code session build a page from `brief`, which it sees and nothing else, on `model`
 * or, when none is given, on Claude Code's default.
 */
export async function runArtifactSession(
  brief: string,
  context: Parameters<typeof executeTool>[2],
  model?: ClaudeCodeModel,
) {
  return await executeTool(runCodingTask, { task: brief, model }, context);
}

/** A fenced HTML code block; the last one is taken, as the brief asks for the page at the end. */
const HTML_CODE_BLOCK_PATTERN = /```html[^\S\n]*\n([\s\S]*?)\n?```/gi;

/** An HTML document that was not fenced: from its doctype or `<html>` tag to its closing tag. */
const HTML_DOCUMENT_PATTERN = /(?:<!doctype html[^>]*>|<html[\s>])[\s\S]*<\/html>/i;

/**
 * Finds the page in what the session reported.
 *
 * The brief asks for the document in a fenced block at the end, and the last such block wins, so
 * a session that showed a snippet on the way is not taken at its first one. A session that left
 * the fence off still has its document found, as long as it is a whole one.
 */
export function findArtifactHtml(message: string): string | undefined {
  const fencedBlocks = [...message.matchAll(HTML_CODE_BLOCK_PATTERN)].map((match) => match[1].trim());
  const candidate = fencedBlocks[fencedBlocks.length - 1] ?? message.match(HTML_DOCUMENT_PATTERN)?.[0].trim();

  return candidate && /<\/html>\s*$/i.test(candidate) ? candidate : undefined;
}

/**
 * Has a Claude Code session build a page for a request.
 *
 * A shortcut onto the coding vertical's `runCodingTask`: the caller says what to show, and the
 * shortcut turns that into a brief the session can work from alone. The page itself is in the
 * session's `final_message`, where {@link findArtifactHtml} reads it from.
 */
export const createArtifact = createShortcut({
  id: 'createArtifact',
  description:
    "Have a Claude Code session build an interactive web page (an artifact) for what `task` describes, and report back with the page's HTML at the end of `final_message`. Takes a few minutes. `task` should say what to show and include any data the page needs, since the session can't reach Jarvis's own.",
  tool: runCodingTask,
  execute: async (inputData, context) =>
    await runArtifactSession(buildArtifactTask(inputData.task), context, inputData.model),
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

export const visualizeShortcuts = {
  createArtifact,
  openArtifactOnPhone,
};
