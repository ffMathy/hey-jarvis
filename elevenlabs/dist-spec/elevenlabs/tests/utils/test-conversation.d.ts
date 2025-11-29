import type { ServerMessage } from './conversation-strategy';
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
  score: number;
  reasoning: string;
}
/**
 * Text-based conversation testing client with LLM-based evaluation capabilities.
 * Uses a ConversationStrategy for the actual conversation implementation.
 */
export declare class TestConversation {
  private strategy;
  private readonly googleApiKey;
  constructor(options: ConversationOptions);
  connect(): Promise<void>;
  sendMessage(text: string): Promise<string>;
  /**
   * Get all raw messages received
   */
  getMessages(): ServerMessage[];
  /**
   * Get conversation transcript as formatted text for evaluation
   * Includes user messages, agent responses, and tool calls
   */
  getTranscriptText(): string;
  /**
   * Evaluate the conversation transcript against specific criteria using an LLM
   *
   * @param criteria - Evaluation criteria (e.g., "The agent was helpful and polite")
   * @param maxRetries - Maximum number of retries for transient failures (default 3)
   * @returns Evaluation result with passed status, confidence score, and reasoning
   */
  evaluate(criteria: string, maxRetries?: number): Promise<EvaluationResult>;
  /**
   * Assert that the conversation meets specific criteria
   * Throws an error if the criteria is not met
   *
   * @param criteria - Evaluation criteria
   * @param minScore - Minimum score required (0-1, default 0.7)
   * @returns Evaluation result if criteria is met
   * @throws Error if criteria is not met
   */
  assertCriteria(criteria: string, minScore?: number): Promise<EvaluationResult>;
  disconnect(): Promise<void>;
}
//# sourceMappingURL=test-conversation.d.ts.map
