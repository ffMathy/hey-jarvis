import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { ConversationStrategy, ServerMessage } from './conversation-strategy';
import { GeminiMastraConversationStrategy } from './gemini-mastra-conversation-strategy';
import { ElevenLabsConversationStrategy } from './elevenlabs-conversation-strategy';

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
   * Evaluate the conversation transcript against specific criteria using an LLM
   *
   * @param criteria - Evaluation criteria (e.g., "The agent was helpful and polite")
   * @param maxRetries - Maximum number of retries for transient failures (default 3)
   * @returns Evaluation result with passed status, confidence score, and reasoning
   */
  async evaluate(criteria: string, maxRetries = 3): Promise<EvaluationResult> {
    const transcriptText = this.getTranscriptText();
    const schema = z.object({
      passed: z.boolean().describe('Whether the criteria was met'),
      score: z.number().min(0).max(1).describe('Confidence score from 0 to 1'),
      reasoning: z.string().describe('Explanation of why the criteria was or was not met'),
    });

    const google = createGoogleGenerativeAI({ apiKey: this.googleApiKey });

    // Use Vercel AI SDK's built-in retry mechanism
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

EVALUATION CRITERIA:
\`\`\`markdown
${criteria}
\`\`\`

Please evaluate whether the FULL conversation meets the specified criteria. Consider:
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

    if (!result.passed || result.score < minScore) {
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
