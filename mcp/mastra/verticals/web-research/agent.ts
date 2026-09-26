import type { Agent } from '@mastra/core/agent';
import { createAgent } from '../../utils/index.js';
import { webResearchTools } from './tools.js';

/**
 * Web Research Agent
 *
 * **As much research as the question needs, and an answer shaped for where it is going.** The
 * instructions used to ask for as many searches as it takes ("if you are unsure, better do more
 * research first") and for every answer as an HTML email, so a spoken "who won the match last
 * night" waited on several searches and then on the model writing out a formatted document, most
 * of which the voice agent threw away. A question now gets one well-aimed search and a short
 * answer; HTML is written when the result is meant for an email.
 *
 * Thinking stays at Flash's default: judging whether results answer the question, and weighing
 * sources that disagree, is the part of this agent where reasoning pays for itself.
 */
export async function getWebResearchAgent(): Promise<Agent> {
  return createAgent({
    id: 'webResearch',
    name: 'WebResearch',
    instructions: `You are a research agent with access to real-time web search through Google Search tool.

You value factual results. Search as much as the question needs and no more: one well-aimed search usually answers a factual question, so search again only when the results do not answer it, contradict each other, or the request asks for a broad comparison across many sources.

Do not ask questions, make best-guess assumptions.

When you need to search for information:
- Use the googleSearch tool to find relevant web content
- The search results will include URLs and source information
- Always cite your sources with URLs from the search results

How to answer:
- By default, answer directly in a few plain sentences, with the key facts first, then the sources' titles and URLs. Your answer is usually read out loud, so do not use markdown.
- When the request says the result is for an email or asks for HTML, format it in HTML instead. For each result include a title, a summary of the information found and the URLs from the search results. It's important that you don't mix markdown into it - it needs to be pure HTML.`,
    description: `# Purpose
Perform web research on any topic using Google Search tool. The agent uses real-time web search to provide factual, well-researched results with source citations.

# When to use
- The user asks a question that requires current or up-to-date information from the internet
- The user needs comprehensive research on a topic with multiple sources
- The user wants detailed information from web searches with citations
- The user asks for facts, statistics, news, or any information that needs verification from multiple sources
- The user needs research formatted as HTML for email delivery (say so in the prompt)

# How it works
The agent uses the googleSearch tool to:
- Search for relevant web content in real-time
- Search again when the first results do not settle the question
- Extract URLs and citations from search results
- Integrate findings into its answer

# Post-processing
- **Synthesize** information from the search results
- **Summarize** findings clearly with URL citations
- **Format** the answer as a few plain sentences, or as pure HTML (no markdown) when the prompt says it is for an email
- **Prioritize** factual accuracy - search again if the results conflict`,
    tools: webResearchTools,
  });
}
