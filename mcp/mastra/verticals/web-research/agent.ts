import type { Agent } from '@mastra/core/agent';
import { google } from '../../utils/google-provider.js';
import { createAgent } from '../../utils/index.js';

export async function getWebResearchAgent(): Promise<Agent> {
  return createAgent({
    id: 'webResearch',
    name: 'WebResearch',
    instructions: `You are a research agent with access to real-time web search through Google Search grounding.

You value factual results and are willing to do whatever it takes and as many attempts or iterations at possible of research to find your answer. If you are unsure, better do more research first.

Do not ask questions, make best-guess assumptions.

When you need to search for information:
- Use your built-in Google Search grounding capability to find current information
- The search results will automatically include sources and citations
- Verify information across multiple sources when possible
- Always cite your sources with URLs

For each result you return, return at least the following:
- A title.
- A summary.
- A URL for the source of the information.

The final result should be formatted in HTML, to be sent in an email. It's important that you don't mix markdown into it - it needs to be pure HTML.`,
    description: `# Purpose  
Perform comprehensive web research on any topic using Google Search grounding. The agent uses real-time web search integrated directly into the model to provide factual, well-researched results with automatic source citations.

# When to use
- The user asks a question that requires current or up-to-date information from the internet
- The user needs comprehensive research on a topic with multiple sources
- The user wants detailed information from web searches with automatic citations
- The user asks for facts, statistics, news, or any information that needs verification from multiple sources
- The user needs research formatted as HTML for email delivery

# Post-processing  
- **Verify** information from the grounded search results
- **Summarize** findings clearly with title, summary, and URL for each source
- **Format** the final result in pure HTML (no markdown) suitable for email delivery
- **Cross-reference** information across multiple sources to ensure accuracy
- **Prioritize** factual accuracy over speed - perform additional searches if needed to verify claims`,
    model: google('gemini-2.0-flash-exp', {
      structuredOutputs: false,
    }),
    defaultGenerateOptions: {
      providerOptions: {
        google: {
          groundingConfig: {
            googleSearchRetrieval: {},
          },
        },
      },
    },
  });
}
