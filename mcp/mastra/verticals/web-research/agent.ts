import type { Agent } from '@mastra/core/agent';
import { google } from '../../utils/google-provider.js';
import { createAgent } from '../../utils/index.js';
import { webResearchTools } from './tools.js';

export async function getWebResearchAgent(): Promise<Agent> {
  return createAgent({
    id: 'webResearch',
    name: 'WebResearch',
    instructions: `You are a research agent with access to real-time web search through Google Search tool.

You value factual results and are willing to do whatever it takes and as many attempts or iterations of research to find your answer. If you are unsure, better do more research first.

Do not ask questions, make best-guess assumptions.

When you need to search for information:
- Use the googleSearch tool to find relevant web content
- The search results will include URLs and source information
- You can perform multiple searches to gather comprehensive information from various sources
- Always cite your sources with URLs from the search results

For each result you return, include:
- A title
- A summary of the information found
- URLs from the search results

The final result should be formatted in HTML, to be sent in an email. It's important that you don't mix markdown into it - it needs to be pure HTML.`,
    description: `# Purpose  
Perform comprehensive web research on any topic using Google Search tool. The agent uses real-time web search to provide factual, well-researched results with source citations.

# When to use
- The user asks a question that requires current or up-to-date information from the internet
- The user needs comprehensive research on a topic with multiple sources
- The user wants detailed information from web searches with citations
- The user asks for facts, statistics, news, or any information that needs verification from multiple sources
- The user needs research formatted as HTML for email delivery

# How it works
The agent uses the googleSearch tool to:
- Search for relevant web content in real-time
- Gather information from multiple sources via multiple searches
- Extract URLs and citations from search results
- Integrate findings into comprehensive responses

# Post-processing  
- **Synthesize** information from multiple search results
- **Summarize** findings clearly with title, summary, and URL citations
- **Format** the final result in pure HTML (no markdown) suitable for email delivery
- **Leverage** multiple searches to ensure accuracy
- **Prioritize** factual accuracy - perform additional searches if needed to verify claims`,
    tools: webResearchTools,
  });
}
