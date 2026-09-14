import { z } from 'zod';

/**
 * A recipe stripped down to what is needed to *browse* the catalogue.
 *
 * Valdemarsro has thousands of recipes, and a full recipe carries its
 * description, directions and ingredient list. Serialising all of them into a
 * prompt is what blew past the model's input token limit, so recipe selection
 * runs on these entries instead and the two winners are fetched in full
 * afterwards.
 */
export const recipeCatalogEntrySchema = z
  .object({
    id: z.number(),
    title: z.string(),
    categories: z.array(z.string()),
    summary: z.string().describe('Short plain-text description of the recipe'),
    preparationTime: z.string().optional(),
    servings: z.number().optional(),
  })
  .describe('Compact recipe entry, without ingredients or directions');

export type RecipeCatalogEntry = z.infer<typeof recipeCatalogEntrySchema>;

/** How many candidates a selection prompt is allowed to carry. */
export const MAX_RECIPE_CANDIDATES = 120;

/** How many recipes a weekly meal plan is built from. */
export const RECIPES_PER_MEAL_PLAN = 2;

/** How long a catalogue entry's summary may be, in characters. */
const MAX_SUMMARY_LENGTH = 160;

/** Categories that mark a recipe as dinner food. */
const DINNER_CATEGORY_PATTERN = /aftensmad|hovedret/i;

/**
 * Words too common to say anything about which recipe the user wants. Danish
 * first, since the feedback arrives in Danish, then the English equivalents.
 */
const PREFERENCE_STOP_WORDS = new Set([
  'med',
  'uden',
  'ikke',
  'noget',
  'nogle',
  'gerne',
  'helst',
  'jeg',
  'vil',
  'have',
  'kan',
  'skal',
  'til',
  'for',
  'den',
  'det',
  'der',
  'som',
  'byt',
  'skift',
  'ret',
  'retten',
  'retter',
  'mad',
  'madplan',
  'ugen',
  'uge',
  'and',
  'the',
  'with',
  'without',
  'not',
  'please',
  'some',
  'more',
  'less',
  'want',
  'like',
  'swap',
  'replace',
  'meal',
  'plan',
  'dish',
  'week',
]);

/**
 * Turns an HTML description into a short plain-text summary.
 *
 * @param html - Description markup as the API returns it
 * @param maxLength - Longest summary to return, ellipsis included
 */
export function toPlainTextSummary(html: string | undefined, maxLength: number = MAX_SUMMARY_LENGTH): string {
  const text = (html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length <= maxLength) {
    return text;
  }

  // Cut on a word boundary when there is one close enough to the limit.
  const truncated = text.slice(0, maxLength - 1);
  const lastSpace = truncated.lastIndexOf(' ');
  const body = lastSpace > maxLength / 2 ? truncated.slice(0, lastSpace) : truncated;

  return `${body.trimEnd()}…`;
}

/**
 * Splits free-form preferences into the words worth matching recipes against.
 */
export function extractPreferenceKeywords(preferences: string | undefined): string[] {
  if (!preferences) {
    return [];
  }

  const words = preferences
    .toLowerCase()
    .split(/[^\p{Letter}\p{Number}]+/u)
    .filter((word) => word.length >= 3 && !PREFERENCE_STOP_WORDS.has(word));

  return Array.from(new Set(words));
}

function matchesPreferences(entry: RecipeCatalogEntry, keywords: string[]): boolean {
  const haystack = `${entry.title} ${entry.categories.join(' ')} ${entry.summary}`.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

function isDinnerRecipe(entry: RecipeCatalogEntry): boolean {
  return entry.categories.some((category) => DINNER_CATEGORY_PATTERN.test(category));
}

/** Fisher-Yates, so every ordering is equally likely for a fair `random`. */
function shuffle<T>(items: T[], random: () => number): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Narrows the full catalogue down to a shortlist small enough to prompt with.
 *
 * Dinner recipes win over everything else, recipes matching the user's
 * preferences win over the rest of the dinner recipes, and whatever room is
 * left is filled at random so two runs in a row do not propose the same week.
 *
 * @param entries - Every catalogue entry available
 * @param options.preferences - Free-form preferences from the user, if any
 * @param options.limit - Most candidates to return
 * @param options.random - Random source, injectable for tests
 */
export function shortlistRecipeCandidates(
  entries: RecipeCatalogEntry[],
  options: { preferences?: string; limit?: number; random?: () => number } = {},
): RecipeCatalogEntry[] {
  const limit = Math.max(0, options.limit ?? MAX_RECIPE_CANDIDATES);
  const random = options.random ?? Math.random;

  // Only fall back to the whole catalogue when nothing is marked as dinner — a
  // small dinner selection is still a better shortlist than a mixed one.
  const dinnerEntries = entries.filter(isDinnerRecipe);
  const pool = dinnerEntries.length > 0 ? dinnerEntries : entries;

  const keywords = extractPreferenceKeywords(options.preferences);
  const preferred = keywords.length > 0 ? pool.filter((entry) => matchesPreferences(entry, keywords)) : [];
  const preferredIds = new Set(preferred.map((entry) => entry.id));
  const rest = pool.filter((entry) => !preferredIds.has(entry.id));

  return [...shuffle(preferred, random), ...shuffle(rest, random)].slice(0, limit);
}

/**
 * Turns the ids an agent picked into the ids the meal plan will actually use.
 *
 * Agents occasionally return an id that was never on the shortlist, repeat one,
 * or return fewer than asked for. Rather than failing the run — or fetching a
 * recipe that does not exist — unknown ids are dropped and the shortlist tops
 * the selection back up.
 *
 * @param selectedIds - The ids the agent returned
 * @param candidateIds - The ids the agent was allowed to choose from
 * @param count - How many recipes the meal plan needs
 */
export function resolveSelectedRecipeIds(
  selectedIds: number[],
  candidateIds: number[],
  count: number = RECIPES_PER_MEAL_PLAN,
): number[] {
  const allowed = new Set(candidateIds);
  const resolved: number[] = [];
  const seen = new Set<number>();

  const take = (id: number) => {
    if (seen.has(id) || resolved.length >= count) {
      return;
    }
    seen.add(id);
    resolved.push(id);
  };

  for (const id of selectedIds) {
    // With no shortlist to check against (state lost between steps), trust the
    // agent rather than dropping everything it picked.
    if (allowed.size === 0 || allowed.has(id)) {
      take(id);
    }
  }

  for (const id of candidateIds) {
    if (resolved.length >= count) {
      break;
    }
    take(id);
  }

  return resolved;
}
