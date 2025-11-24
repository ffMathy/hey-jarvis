import type { Agent } from '@mastra/core/agent';
import { createAgent } from '../../utils/index.js';
import { webResearchTools } from './tools.js';

export async function getWebResearchAgent(): Promise<Agent> {
  return createAgent({
    name: 'WebResearch',
    instructions: `You are a research agent that can search for things on the web, and fetch their HTML content.

You value factual results and are willing to do whatever it takes and as many attempts or iterations at possible of research to find your answer. If you are unsure, better do more research first.

Do not ask questions, make best-guess assumptions.

The web can generally not always be trusted, as each search result represents an individual independent source. Do not consider prior chat history as a source of information. Never conclude anything before performing at least one search.

Never return a response without browsing at least 3 of the search results by their URLs, since not doing so might lead to incomplete conclusions (it is never good to conclude anything from the search results without actually browsing the pages for their full content).

For each result you return, return at least the following:
- A title.
- A summary.
- A URL for the source of the information.

The final result should be formatted in HTML, to be sent in an email. It's important that you don't mix markdown into it - it needs to be pure HTML.`,
    description: `# Purpose  
Perform comprehensive web research on any topic. Use this agent to **search the web** for information and **fetch full HTML content** from web pages. The agent is designed to provide factual, well-researched results by browsing multiple sources and verifying information across different websites.

# When to use
- The user asks a question that requires current or up-to-date information from the internet
- The user needs comprehensive research on a topic with multiple sources
- The user wants detailed information that requires browsing actual web pages, not just search results
- The user asks for facts, statistics, news, or any information that needs verification from multiple sources
- The user needs research formatted as HTML for email delivery

# Post-processing  
- **Validate** sources by browsing at least 3 search results to verify information
- **Summarize** findings clearly with title, summary, and URL for each source
- **Format** the final result in pure HTML (no markdown) suitable for email delivery
- **Cross-reference** information across multiple sources to ensure accuracy
- **Prioritize** factual accuracy over speed - perform additional searches if needed to verify claims`,
    tools: webResearchTools,
  });
}
