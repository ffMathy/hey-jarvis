import {
    createCompletenessScorer,
} from '@mastra/evals/scorers/code';
import {
    createAnswerRelevancyScorer,
    createBiasScorer,
    createHallucinationScorer,
    createPromptAlignmentScorerLLM
} from '@mastra/evals/scorers/llm';
import { google } from './google-provider';

/**
 * Evaluation model used for all scorers in the Hey Jarvis system.
 * Using Gemini Flash Latest for cost-effectiveness while maintaining quality.
 */
const SCORER_MODEL = google('gemini-flash-latest');

/**
 * Default sampling rate for live evaluations.
 * 0.1 = 10% of responses will be scored (good balance between monitoring and cost)
 */
const DEFAULT_SAMPLING_RATE = 1.0;

/**
 * Hey Jarvis default scorers configuration for agents and workflows.
 * These scorers provide comprehensive evaluation across multiple dimensions:
 * 
 * - **answer-relevancy**: How well responses address the input query
 * - **faithfulness**: How accurately responses represent provided context
 * - **hallucination**: Detection of factual contradictions and unsupported claims
 * - **completeness**: Whether responses include all necessary information
 * - **prompt-alignment**: How well responses align with prompt intent
 * - **bias**: Detection of potential biases in outputs
 */
export const DEFAULT_SCORERS = {
    answerRelevancy: {
        scorer: createAnswerRelevancyScorer({ model: SCORER_MODEL }),
        sampling: { type: 'ratio' as const, rate: DEFAULT_SAMPLING_RATE },
    },
    hallucination: {
        scorer: createHallucinationScorer({ model: SCORER_MODEL }),
        sampling: { type: 'ratio' as const, rate: DEFAULT_SAMPLING_RATE },
    },
    completeness: {
        scorer: createCompletenessScorer(),
        sampling: { type: 'ratio' as const, rate: DEFAULT_SAMPLING_RATE },
    },
    promptAlignment: {
        scorer: createPromptAlignmentScorerLLM({ model: SCORER_MODEL }),
        sampling: { type: 'ratio' as const, rate: DEFAULT_SAMPLING_RATE },
    },
    bias: {
        scorer: createBiasScorer({ model: SCORER_MODEL }),
        sampling: { type: 'ratio' as const, rate: DEFAULT_SAMPLING_RATE },
    },
};

/**
 * Creates a tool call accuracy scorer with the provided tools configuration.
 * This scorer requires specific tool information and cannot be included in the default set.
 * It needs to be configured per-agent based on the actual tools available.
 * 
 * Note: This is commented out for now as it requires complex tool configuration.
 * To use it, you'll need to provide the actual Tool objects from the agent.
 * 
 * @example
 * ```typescript
 * // Example usage (requires actual Tool objects):
 * // const toolCallScorer = {
 * //   scorer: createToolCallAccuracyScorerLLM({
 * //     model: SCORER_MODEL,
 * //     availableTools: myAgent.tools, // Actual Tool objects
 * //   }),
 * //   sampling: { type: 'ratio', rate: DEFAULT_SAMPLING_RATE },
 * // };
 * ```
 */

/**
 * Creates a custom scorers configuration by merging defaults with user overrides.
 * 
 * @param customScorers - Custom scorers configuration to merge with defaults
 * @param samplingRate - Override the default sampling rate for all scorers
 * @returns Merged scorers configuration
 * 
 * @example
 * ```typescript
 * // Use all defaults
 * const scorers = createScorersConfig();
 * 
 * // Override sampling rate for production (lower cost)
 * const prodScorers = createScorersConfig({}, 0.05);
 * 
 * // Add custom scorer and override sampling
 * const customScorers = createScorersConfig({
 *   customScorer: {
 *     scorer: myCustomScorer(),
 *     sampling: { type: 'ratio', rate: 1.0 },
 *   },
 * }, 0.2);
 * ```
 */
export function createScorersConfig(
    customScorers: Record<string, { scorer: unknown; sampling: { type: 'ratio'; rate: number } }> = {},
    samplingRate: number = DEFAULT_SAMPLING_RATE
) {
    // Apply custom sampling rate to all default scorers if specified
    const scorersWithCustomRate = Object.fromEntries(
        Object.entries(DEFAULT_SCORERS).map(([key, config]) => [
            key,
            {
                ...config,
                sampling: { ...config.sampling, rate: samplingRate },
            },
        ])
    );

    return {
        ...scorersWithCustomRate,
        ...customScorers,
    };
}