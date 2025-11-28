import {
  createAnswerRelevancyScorer,
  createBiasScorer,
  createCompletenessScorer,
  createHallucinationScorer,
  createPromptAlignmentScorerLLM,
} from '@mastra/evals/scorers/prebuilt';
import { google } from './google-provider.js';

/**
 * Default sampling rate for live evaluations.
 * 0.1 = 10% of responses will be scored (good balance between monitoring and cost)
 */
const DEFAULT_SAMPLING_RATE = 0.1;

/**
 * Lazy initialization of the scorer model to avoid import-time failures.
 * Only creates the Google model when scorers are actually instantiated.
 */
let scorerModel: ReturnType<typeof google> | null = null;
function getScorerModel() {
  if (!scorerModel) {
    scorerModel = google('gemini-flash-latest');
  }
  return scorerModel;
}

/**
 * Lazy initialization function for default scorers.
 * This prevents scorer instantiation at module load time, which could fail
 * during build/test if the environment isn't fully configured.
 *
 * Scorers provide comprehensive evaluation across multiple dimensions:
 * - **answer-relevancy**: How well responses address the input query
 * - **hallucination**: Detection of factual contradictions and unsupported claims
 * - **completeness**: Whether responses include all necessary information
 * - **prompt-alignment**: How well responses align with prompt intent
 * - **bias**: Detection of potential biases in outputs
 */
function createDefaultScorers() {
  const model = getScorerModel();
  return {
    // answerRelevancy: {
    //   scorer: createAnswerRelevancyScorer({ model }),
    //   sampling: { type: 'ratio' as const, rate: DEFAULT_SAMPLING_RATE },
    // },
    // hallucination: {
    //   scorer: createHallucinationScorer({ model }),
    //   sampling: { type: 'ratio' as const, rate: DEFAULT_SAMPLING_RATE },
    // },
    // completeness: {
    //   scorer: createCompletenessScorer(),
    //   sampling: { type: 'ratio' as const, rate: DEFAULT_SAMPLING_RATE },
    // },
    // promptAlignment: {
    //   scorer: createPromptAlignmentScorerLLM({ model }),
    //   sampling: { type: 'ratio' as const, rate: DEFAULT_SAMPLING_RATE },
    // },
    // bias: {
    //   scorer: createBiasScorer({ model }),
    //   sampling: { type: 'ratio' as const, rate: DEFAULT_SAMPLING_RATE },
    // },
  } as const;
}

/**
 * Cache for default scorers to avoid recreating them on every call.
 */
let defaultScorersCache: ReturnType<typeof createDefaultScorers> | null = null;

/**
 * Gets the default scorers configuration, creating them lazily on first access.
 */
export function getDefaultScorers() {
  if (!defaultScorersCache) {
    defaultScorersCache = createDefaultScorers();
  }
  return defaultScorersCache;
}

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
  samplingRate: number = DEFAULT_SAMPLING_RATE,
) {
  // Get default scorers (lazy initialization)
  const defaultScorers = getDefaultScorers();

  // Apply custom sampling rate to all default scorers if specified
  const scorersWithCustomRate = Object.fromEntries(
    Object.entries(defaultScorers).map(([key, config]) => [
      key,
      {
        ...config,
        sampling: { ...config.sampling, rate: samplingRate },
      },
    ]),
  );

  return {
    ...scorersWithCustomRate,
    ...customScorers,
  };
}
