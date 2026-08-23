import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { z } from 'zod';
import {
  classifyAcknowledgementTiming,
  countResponsesAfterRequest,
  describeMessageOrder,
  findLookupPromisesBeforeRouting,
} from './acknowledgement-timing';
import type { ConversationStrategy, ServerMessage } from './conversation-strategy';
import { ElevenLabsConversationStrategy } from './elevenlabs-conversation-strategy';
import { describeRoutingLoop, readRoutingLoop } from './routing-loop';
import { findSpokenToolCalls } from './spoken-tool-call';

export interface ConversationOptions {
  agentId: string;
  apiKey?: string;
  googleApiKey?: string;
}

/**
 * Evaluation criteria result
 */
export interface EvaluationResult {
  passed: boolean;
  score: number; // 0-1
  reasoning: string;
}

/**
 * Text-based conversation testing client with LLM-based evaluation capabilities.
 * Uses a ConversationStrategy for the actual conversation implementation.
 */
export class TestConversation {
  private strategy: ConversationStrategy;
  private readonly googleApiKey: string | undefined;

  constructor(options: ConversationOptions) {
    const apiKey = options.apiKey || process.env.HEY_JARVIS_ELEVENLABS_API_KEY!;

    this.googleApiKey = options.googleApiKey || process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY;

    this.strategy = new ElevenLabsConversationStrategy({
      agentId: options.agentId,
      apiKey,
    });
  }

  async connect(): Promise<void> {
    await this.strategy.connect();
  }

  async sendMessage(text: string): Promise<string> {
    return await this.strategy.sendMessage(text);
  }

  /**
   * Get all raw messages received
   */
  getMessages(): ServerMessage[] {
    return this.strategy.getMessages();
  }

  /**
   * Get conversation transcript as formatted text for evaluation
   * Includes user messages, agent responses, and tool calls
   */
  getTranscriptText(): string {
    return this.strategy.getTranscriptText();
  }

  /**
   * What the connection itself showed, extracted mechanically rather than read out
   * of the prose. A regex knows whether a tool name was spoken and the message log
   * knows whether a tool ran; a model reading a transcript only guesses at both.
   *
   * This goes to the evaluator alongside the transcript so its score rests on facts
   * it was handed, leaving it to judge the thing it is actually good at: whether
   * what happened satisfies the criteria.
   */
  getEvidenceText(): string {
    const messages = this.getMessages();

    const toolCalls = messages
      .filter((message) => message.type === 'mcp_tool_call')
      .map((message, index) => `  ${index + 1}. ${message.mcp_tool_call.tool_name} (${message.mcp_tool_call.state})`);

    const spokenToolCalls = findSpokenToolCalls(messages);
    const lookupPromises = findLookupPromisesBeforeRouting(messages);

    // Only shown once something was routed. A conversation with no routing in it
    // has no loop to describe, and an empty section would be noise in the evals
    // whose whole point is that nothing was called.
    const routingLoop = readRoutingLoop(messages);
    const routingSection = routingLoop.steps.length > 0 ? ['', describeRoutingLoop(routingLoop)] : [];

    return [
      `Tool calls the agent actually made, in order (${toolCalls.length} total):`,
      toolCalls.length > 0 ? toolCalls.join('\n') : '  (none)',
      '',
      `Times the agent spoke after the user's last request: ${countResponsesAfterRequest(messages)}`,
      `Acknowledgement timing: ${classifyAcknowledgementTiming(messages).kind}`,
      `  ("acknowledged" = the user heard something before the results; "silent" = the`,
      `   agent said nothing until the whole lookup had finished; "no-tool-call" = nothing`,
      `   was routed, so the question does not arise)`,
      '',
      `Tool names spoken aloud by the agent: ${spokenToolCalls.length > 0 ? spokenToolCalls.join('; ') : 'none'}`,
      `Lookups the agent announced before routing: ${lookupPromises.length > 0 ? lookupPromises.join('; ') : 'none'}`,
      '',
      `Message order: ${describeMessageOrder(messages)}`,
      ...routingSection,
    ].join('\n');
  }

  /**
   * Poll for the tools the agent invoked until one matches, or the timeout elapses.
   * The agent answers before its tool finishes, so the calls are not necessarily
   * all in by the time sendMessage() returns.
   */
  async waitForCalledToolNames(matches: (toolName: string) => boolean, timeoutMs: number): Promise<string[]> {
    const deadline = Date.now() + timeoutMs;
    let toolNames = await this.getCalledToolNames();

    while (!toolNames.some(matches) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      toolNames = await this.getCalledToolNames();
    }

    return toolNames;
  }

  /**
   * Names of the tools the agent actually invoked during the conversation.
   */
  async getCalledToolNames(): Promise<string[]> {
    return await this.strategy.getCalledToolNames();
  }

  /**
   * Evaluate the conversation transcript against specific criteria using an LLM
   *
   * @param criteria - Evaluation criteria (e.g., "The agent was helpful and polite")
   * @param maxRetries - Maximum number of retries for transient failures (default 3)
   * @returns Evaluation result with passed status, confidence score, and reasoning
   */
  async evaluate(criteria: string, maxRetries = 3): Promise<EvaluationResult> {
    const transcriptText = this.getTranscriptText();
    const evidenceText = this.getEvidenceText();
    const schema = z.object({
      passed: z.boolean().describe('Whether the criteria was met'),
      score: z.number().min(0).max(1).describe('Confidence score from 0 to 1'),
      reasoning: z.string().describe('Explanation of why the criteria was or was not met'),
    });

    const google = createGoogleGenerativeAI({ apiKey: this.googleApiKey });

    // Use Vercel AI SDK's built-in retry mechanism
    // biome-ignore lint/suspicious/noExplicitAny: Vercel AI SDK generateObject requires `any` for dynamic schema
    const result = await generateObject<any>({
      model: google('gemini-flash-latest'),
      temperature: 0,
      schema,
      maxRetries, // Vercel AI SDK v5+ supports built-in retry with exponential backoff
      prompt: `You are evaluating a conversation transcript between a user and an AI agent.

IMPORTANT: Evaluate the ENTIRE conversation transcript below, not just individual messages.
Consider the full context and flow across ALL exchanges.

CONVERSATION TRANSCRIPT (COMPLETE):
\`\`\`markdown
${transcriptText}
\`\`\`

MECHANICALLY EXTRACTED EVIDENCE:
This was read directly off the connection, not inferred from the transcript above.
It is authoritative — where it disagrees with your reading of the prose, believe it.
\`\`\`
${evidenceText}
\`\`\`

EVALUATION CRITERIA:
\`\`\`markdown
${criteria}
\`\`\`

Please evaluate whether the FULL conversation meets the specified criteria. Consider:
- The mechanically extracted evidence, which settles any question about what tools ran,
  what was spoken aloud, and in what order — do not second-guess it from the prose
- ALL messages in the transcript, not just the first or last
- The semantic meaning and intent, not just exact wording
- The overall flow and context across the ENTIRE conversation
- Whether the agent's responses appropriately address the user's messages throughout
- Consistency of behavior across multiple exchanges

Respond with:
- "passed" (boolean): Whether the criteria is met across the FULL transcript
- "score" (number 0-1): Confidence score based on the ENTIRE conversation
- "reasoning" (string): Clear explanation for your evaluation with specific examples from the transcript`,
    });

    return result.object as EvaluationResult;
  }

  /**
   * Assert that the conversation meets specific criteria
   * Throws an error if the criteria is not met
   *
   * @param criteria - Evaluation criteria
   * @param minScore - Minimum score required (0-1, default 0.7)
   * @returns Evaluation result if criteria is met
   * @throws Error if criteria is not met
   */
  async assertCriteria(criteria: string, minScore = 0.7): Promise<EvaluationResult> {
    const result = await this.evaluate(criteria);

    if (result.score < minScore) {
      throw new Error(
        `Conversation failed to meet criteria (scored: ${result.score} but needed: ${minScore}):\n` +
          `Criteria: ${criteria}\n` +
          `Reasoning: ${result.reasoning}\n\n` +
          `Transcript:\n${this.getTranscriptText()}`,
      );
    }

    console.debug('✅ ', criteria, '\n', this.getTranscriptText(), '\n', result);

    return result;
  }

  async disconnect(): Promise<void> {
    await this.strategy.disconnect();
  }
}
