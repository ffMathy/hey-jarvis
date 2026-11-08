import { createTypeSafeAi, type TypeSafeAiProvider } from '@ai-sdk/typesafe-ai';

/**
 * TypeSafe AI's decision models -- Jev -- configured with HEY_JARVIS_TYPESAFE_AI_API_KEY.
 *
 * A decision model is not a language model. It writes nothing: it is handed a state and a set of
 * questions whose answers are fixed in advance, and returns a probability for each answer -- or
 * declines a question it will not answer. That is the shape of every decision Jarvis makes before
 * any real work starts -- which agent, how to speak -- and it is answered in one short call rather
 * than a generation.
 *
 * The key is optional. Without it nothing classifies, and every decision falls back to the
 * language model that made it before classifiers existed, so a missing key costs speed and
 * nothing else. That is why callers ask {@link isDecisionModelConfigured} rather than letting
 * each request fail against the API with a key it does not have.
 */

const typeSafeApiKey = process.env.HEY_JARVIS_TYPESAFE_AI_API_KEY;

/** Jev's current version, which is the only one TypeSafe serves under a stable name. */
const DECISION_MODEL = 'jev-latest';

const typeSafeAi = createTypeSafeAi({ apiKey: typeSafeApiKey || 'not-configured' });

/** Whether there is a key to decide with at all. */
export function isDecisionModelConfigured(): boolean {
  return Boolean(typeSafeApiKey);
}

/**
 * The decision model every classifier runs on.
 *
 * Annotated because the inferred type names `@ai-sdk/provider` v4, which only the TypeSafe
 * package depends on and so cannot be named from here.
 */
export function getDecisionModel(): ReturnType<TypeSafeAiProvider['decisionModel']> {
  return typeSafeAi.decisionModel(DECISION_MODEL);
}
