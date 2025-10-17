import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { z } from 'zod';
import { ElevenLabsConversationClient } from './websocket-client';

/**
 * Evaluation criteria result
 */
export interface EvaluationResult {
  passed: boolean;
  score: number; // 0-1
  reasoning: string;
}

/**
 * Conversation transcript entry
 */
export interface TranscriptEntry {
  role: 'user' | 'agent';
  message: string;
  timestamp: number;
}

/**
 * Test conversation wrapper that adds LLM-based evaluation capabilities
 * to the ElevenLabsConversationClient for more robust testing.
 */
export class TestConversation {
  private client: ElevenLabsConversationClient;
  private transcript: TranscriptEntry[] = [];
  private googleApiKey: string | undefined;

  constructor(options: {
    agentId: string;
    apiKey?: string;
    googleApiKey?: string;
  }) {
    this.client = new ElevenLabsConversationClient({
      agentId: options.agentId,
      apiKey: options.apiKey,
    });
    this.googleApiKey =
      options.googleApiKey ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY;
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  /**
   * Send a message and record it in the transcript
   */
  async sendMessage(text: string): Promise<string> {
    this.transcript.push({
      role: 'user',
      message: text,
      timestamp: Date.now(),
    });

    const response = await this.client.chat(text);

    this.transcript.push({
      role: 'agent',
      message: response,
      timestamp: Date.now(),
    });

    return response;
  }

  /**
   * Get the full conversation transcript
   */
  getTranscript(): TranscriptEntry[] {
    return [...this.transcript];
  }

  /**
   * Get the transcript formatted as a string
   */
  getTranscriptText(): string {
    return this.transcript
      .map((entry) => `${entry.role.toUpperCase()}: ${entry.message}`)
      .join('\n');
  }

  /**
   * Clear the transcript
   */
  clearTranscript(): void {
    this.transcript = [];
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

    const result = await generateObject({
      model: google('gemini-flash-latest'),
      schema,
      prompt: `You are evaluating a conversation transcript between a user and an AI agent.

CONVERSATION TRANSCRIPT:
${transcriptText}

EVALUATION CRITERIA:
${criteria}

Please evaluate whether the conversation meets the specified criteria. Consider:
- The semantic meaning and intent, not just exact wording
- The overall flow and context of the conversation
- Whether the agent's responses appropriately address the user's messages

Respond with:
- "passed" (boolean): Whether the criteria is met
- "score" (number 0-1): Confidence score
- "reasoning" (string): Clear explanation for your evaluation`,
    });

    return result.object;
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
}
