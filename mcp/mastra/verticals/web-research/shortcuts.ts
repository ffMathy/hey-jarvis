import { createShortcut } from '../../utils/shortcut-factory.js';
import { executeTool } from '../../utils/tool-factory.js';
import { generateUserInterface } from '../generative-ui/tools.js';

/**
 * Shortcuts are tools that piggy-back on other verticals' capabilities.
 *
 * Research is often easier to take in as a picture than read aloud: a comparison, a timeline, a
 * set of figures. Building a page for it is the generative UI vertical's job, but the findings
 * live here, in the research agent's own context -- and the page builder sees nothing but the
 * request it is handed. So the agent that did the research is the one that hands them over,
 * rather than the planner routing a second request that would have to repeat the research first.
 *
 * `generateUserInterface` is marked slow, and `createShortcut` carries the mark over, so routing
 * offers to notify the user as soon as the build starts rather than holding the call open.
 */
export const visualizeResearch = createShortcut({
  id: 'visualizeResearch',
  description:
    "Turn research you have already done into an interactive web page (an artifact) and, by default, push it to the primary user's phone. Use it when the user asks to see, show, chart, compare visually or visualize what was found. The page builder sees nothing but the request, so put every finding, figure and source URL it should show into it. Takes a few minutes.",
  tool: generateUserInterface,
  execute: async (inputData, context) => await executeTool(generateUserInterface, inputData, context),
});

export const webResearchShortcuts = {
  visualizeResearch,
};
