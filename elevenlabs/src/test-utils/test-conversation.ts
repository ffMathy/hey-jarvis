import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { z } from 'zod';
import {
  ElevenLabsConversationStrategy,
} from './elevenlabs-conversation-strategy';
import type { ConversationStrategy, ServerMessage } from './conversation-strategy';

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
  private readonly strategy: ConversationStrategy;
  private readonly googleApiKey: string | undefined;

  constructor(options: ConversationOptions) {
    const apiKey =
      options.apiKey || process.env.HEY_JARVIS_ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error(
        'API key required: set HEY_JARVIS_ELEVENLABS_API_KEY or pass apiKey'
      );
    }

    this.googleApiKey =
      options.googleApiKey ||
      process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY;

    // Default to ElevenLabs strategy
    this.strategy = new ElevenLabsConversationStrategy({
      agentId: options.agentId,
      apiKey,
    });
  }

  async connect(): Promise<void> {
    await this.strategy.connect();
  }

  async sendMessage(text: string): Promise<void> {
    await this.strategy.sendMessage(text);
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
   * @returns Evaluation result with passed status, confidence score, and reasoning
   */
  async evaluate(criteria: string): Promise<EvaluationResult> {
    const transcriptText = this.getTranscriptText();
const schema = z.object({
      passed: z.boolean().describe('Whether the criteria was met'),
      score: z
        .number()
        .min(0)
        .max(1)
        .describe('Confidence score from 0 to 1'),
      reasoning: z
        .string()
        .describe('Explanation of why the criteria was or was not met'),
    });

    const google = createGoogleGenerativeAI({ apiKey: this.googleApiKey });

    const result = await generateObject<any>({
      model: google('gemini-flash-latest'),
      schema,
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
  async assertCriteria(
    criteria: string,
    minScore = 0.7
  ): Promise<EvaluationResult> {
    const result = await this.evaluate(criteria);

    if (!result.passed || result.score < minScore) {
      throw new Error(
        `Conversation failed to meet criteria (score: ${result.score}):\n` +
          `Criteria: ${criteria}\n` +
          `Reasoning: ${result.reasoning}\n\n` +
          `Transcript:\n${this.getTranscriptText()}`
      );
    }

    return result;
  }

  async disconnect(): Promise<void> {
    await this.strategy.disconnect();
  }
}
