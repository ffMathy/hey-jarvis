import { createAgent } from '../../utils/agent-factory.js';
import { getOllamaModelOrFallback } from '../../utils/providers/ollama-provider.js';
import { withRetry } from '../../utils/retry.js';
import {
  type ExtractedPreference,
  extractedPreferencesSchema,
  PROMOTED_SUBSCRIPTION_SOURCE,
  type PromotionSubscription,
} from './preference-promotion.js';

/**
 * Reads the standing preferences out of the reactor's working memory.
 *
 * This lives outside `agent.ts` for the reason `reactor-run.ts` does: specs replace that
 * module wholesale to supply a fake reactor, and anything exported beside
 * `getStateChangeReactorAgent` would vanish for them.
 */

/**
 * The agent that does the reading.
 *
 * Structured output only, no tools and no memory: it is handed everything it needs in
 * the prompt, and an extractor with memory would write its own working memory while
 * reading the reactor's.
 *
 * It runs on the same local model as the reactor, falling back to Gemini Flash Lite
 * where Ollama is not configured. This is a background pass every few hours with nobody
 * waiting on it, over a few hundred words of text, so it is the cheapest model that can
 * do it. A bad answer is contained, too: the plan built from it can only touch
 * subscriptions promoted from memory, and an answer that fails the schema fails the run
 * without changing anything.
 */
async function getPreferenceExtractionAgent() {
  return createAgent({
    id: 'preferenceExtractor',
    name: 'PreferenceExtractor',
    model: getOllamaModelOrFallback(),
    memory: undefined,
    instructions: `You read the notes a home assistant keeps about its user, and find the standing preferences in them that describe reacting to something that happens.

A preference qualifies only when it names an event or a change to watch for, and what the user wants done when it happens:
- "User wants to know about freezing temperatures" qualifies: WHEN "the outdoor temperature drops below freezing", THEN "notify the user".
- "Tell me when mom texts about dinner" qualifies: WHEN "mom sends a message about dinner", THEN "notify the user".
- "User is vegetarian", "User's name is Mathias", "User works from home on Fridays" do not: they are facts, with nothing to watch for.

Split each qualifying preference into:
- whenEvent: the triggering event, as a short clause without the word "when".
- givenCondition: a precondition that must also hold, only when the notes state one; otherwise null.
- thenAction: what to do, as a short imperative clause.
- preference: the text of the note you read it from.
- existingSubscriptionId: when one of the listed existing subscriptions already expresses the same preference, its id, and copy its wording exactly; otherwise null.

Never invent a preference the notes do not state. When there are none, return an empty list.`,
  });
}

/**
 * Builds the extraction prompt.
 *
 * Kept separate from {@link extractPreferences} so its wording can be tested without
 * reaching a model.
 *
 * The existing subscriptions are part of the prompt so the model can point at the one a
 * preference already corresponds to. That is what keeps a preference that is worded a
 * little differently on the next pass from being retired and re-created every time.
 */
export function buildPreferenceExtractionPrompt({
  workingMemory,
  subscriptions,
}: {
  workingMemory: string;
  subscriptions: PromotionSubscription[];
}): string {
  const listed =
    subscriptions.length === 0
      ? '(none)'
      : subscriptions
          .map((subscription) =>
            [
              `- id: ${subscription.id}`,
              `  origin: ${subscription.source === PROMOTED_SUBSCRIPTION_SOURCE ? 'promoted from these notes' : 'registered by the user'}`,
              `  when: ${subscription.whenEvent}`,
              `  given: ${subscription.givenCondition ?? '(none)'}`,
              `  then: ${subscription.thenAction}`,
            ].join('\n'),
          )
          .join('\n');

  return [
    'These are the notes kept about the user:',
    '',
    '<notes>',
    workingMemory.trim(),
    '</notes>',
    '',
    'These subscriptions exist already:',
    '',
    listed,
    '',
    'List every standing preference in the notes that describes reacting to something that happens.',
  ].join('\n');
}

/**
 * Asks the extraction model for the preferences in a working memory.
 *
 * Blank working memory never reaches the model — there is nothing to read, and the
 * answer is known.
 */
export async function extractPreferences(input: {
  workingMemory: string | null;
  subscriptions: PromotionSubscription[];
}): Promise<ExtractedPreference[]> {
  const workingMemory = input.workingMemory?.trim();
  if (!workingMemory) {
    return [];
  }

  const agent = await getPreferenceExtractionAgent();
  const prompt = buildPreferenceExtractionPrompt({ workingMemory, subscriptions: input.subscriptions });

  const response = await withRetry(
    () =>
      agent.generate([{ role: 'user', content: prompt }], {
        structuredOutput: { schema: extractedPreferencesSchema },
        toolChoice: 'none',
      }),
    { label: 'preference extraction' },
  );

  // Parsed rather than trusted: an answer that does not fit the schema has to fail the
  // run before the plan is built, because the plan retires whatever the answer omits.
  return extractedPreferencesSchema.parse(response.object).preferences;
}
