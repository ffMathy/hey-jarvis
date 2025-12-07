import type { Agent } from '@mastra/core/agent';
import { google } from '../../utils/google-provider.js';
import { createAgent } from '../../utils/index.js';

export async function getWebResearchAgent(): Promise<Agent> {
  return createAgent({
    id: 'webResearch',
    name: 'WebResearch',
    instructions: `You are a research agent with access to real-time web search through Google Search grounding.

You value factual results and are willing to do whatever it takes and as many attempts or iterations of research to find your answer. If you are unsure, better do more research first.

Do not ask questions, make best-guess assumptions.

When you search for information:
- Your built-in Google Search grounding will automatically fetch relevant web content
- The search results are integrated directly into your context with source citations
- Multiple sources are automatically retrieved and grounded in your responses
- You will receive grounding metadata that includes URLs and source information

For each result you return, include:
- A title
- A summary of the information found
- URLs from the grounding metadata (these are automatically provided by the search grounding feature)

The final result should be formatted in HTML, to be sent in an email. It's important that you don't mix markdown into it - it needs to be pure HTML.

Note: The Google Search grounding feature handles fetching, processing, and citing multiple web sources automatically. You don't need to explicitly browse URLs - the system does this for you and provides the aggregated information with citations.`,
    description: `# Purpose  
Perform comprehensive web research on any topic using Google Search grounding. The agent uses real-time web search integrated directly into the model to provide factual, well-researched results with automatic source citations.

# When to use
- The user asks a question that requires current or up-to-date information from the internet
- The user needs comprehensive research on a topic with multiple sources
- The user wants detailed information from web searches with automatic citations
- The user asks for facts, statistics, news, or any information that needs verification from multiple sources
- The user needs research formatted as HTML for email delivery

# How it works
Google Search Grounding automatically:
- Fetches relevant web content in real-time
- Aggregates information from multiple sources
- Provides source citations and URLs in the grounding metadata
- Integrates search results directly into the model's context

# Post-processing  
- **Synthesize** information from the automatically grounded search results
- **Summarize** findings clearly with title, summary, and URL citations from grounding metadata
- **Format** the final result in pure HTML (no markdown) suitable for email delivery
- **Leverage** the multi-source grounding to ensure accuracy
- **Prioritize** factual accuracy - the grounding feature handles fetching and verifying multiple sources`,
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
