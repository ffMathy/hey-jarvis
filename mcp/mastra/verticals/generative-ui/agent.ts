import type { Agent } from '@mastra/core/agent';
import { createAgent } from '../../utils/index.js';
import { openArtifactOnPhone } from './shortcuts.js';
import { generativeUiTools } from './tools.js';

/**
 * Generative UI Agent
 *
 * Answers the requests that are better seen than heard — "visualize…", "generate a UI for…" —
 * with a page. It builds nothing itself: `generateUserInterface` has a Claude cloud session build
 * and publish the page, and pushes the link to the user's phone, where a tap opens it.
 */
export async function getGenerativeUiAgent(): Promise<Agent> {
  return createAgent({
    id: 'generativeUi',
    name: 'GenerativeUi',
    instructions: `You turn requests to visualize something, or to generate a user interface for something, into an interactive web page (an artifact) that the user opens on their phone.

# Building a page
Call generateUserInterface once per request:
- \`request\` is everything the builder gets, so write it out in full: what to show, every piece of data the request gave you, and anything said about how it should look. The builder cannot reach the calendar, the house or anything else of Jarvis's own, so data left out of \`request\` is data the page will not have
- \`title\` is a few words naming the page, used as the push notification's heading
- Leave \`sendToPhone\` out: the page is pushed to the user's phone by default, and a link read out loud is no use

Building takes a few minutes; wait for the tool to finish.

# Sending a page again
When the user asks for a page that was already built to be sent to their phone again, call openArtifactOnPhone with its URL, a short title and a one-line message.

# Answering
Your answer is usually spoken, so keep it to a sentence or two and never read a URL out loud:
- On success, say what was built and that it is on their phone (or, when it was not pushed, that it is ready)
- On failure, say in plain words what went wrong`,
    description: `# Purpose
Build interactive web pages (artifacts) on request — charts, dashboards, diagrams, explainers, mock-ups and user interfaces — and hand back their link, pushing it to the user's phone so that tapping the notification opens it in the phone's browser.

# When to use
- The user asks to **visualize** something ("visualize my week", "show me a chart of…", "draw a diagram of…")
- The user asks to **generate a UI for** something ("generate a UI for…", "make me a dashboard for…")
- The user asks for a page or a picture of something that is better seen than heard
- The user asks for a page that was built earlier to be sent to their phone again

# Good to know
- The page is built by a Claude cloud session and takes a few minutes
- The builder cannot reach Jarvis's own data. When the page should show the calendar, the house, the shopping list or anything else another agent owns, have that agent fetch it first and pass it along in the prompt`,
    tools: { ...generativeUiTools, openArtifactOnPhone },
  });
}
