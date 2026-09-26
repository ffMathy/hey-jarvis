import { z } from 'zod';
import { createTool, executeTool } from '../../utils/tool-factory.js';
import { createTtlCache } from '../../utils/ttl-cache.js';
import { recipeCatalogEntrySchema, toPlainTextSummary } from './recipe-catalog.js';

// Interface for Valdemarsro Recipe API responses
interface ValdemarsroRecipe {
  recipe_id: number;
  title: string;
  description: string;
  directions: string;
  categories: Array<{ name: string }>;
  ingredients: Array<{
    ingrediens?: { name: string };
    maengde?: string;
    enhed?: string;
    tekst?: string;
  }>;
  url: string;
  media: string;
  fields: {
    personer_maengde?: {
      antal?: string;
      maengde?: string;
      note?: string;
    };
    tid?: {
      arbejdstid?: string;
      i_alt?: string;
    };
  };
}

interface RecipeResponse {
  data: ValdemarsroRecipe;
}

interface SearchResponse {
  data: {
    result: Array<{
      post_id: number;
    }>;
  };
}

interface RecipePageResponse {
  data: ValdemarsroRecipe[];
  pagination: {
    page: number;
    max_pages: number;
    urls: {
      next?: string;
    };
  };
}

// Get Valdemarsro API key from environment
const getApiKey = () => {
  const apiKey = process.env.HEY_JARVIS_VALDEMARSRO_API_KEY;
  if (!apiKey) {
    throw new Error('Valdemarsro API key not found. Please set VALDEMARSRO_API_KEY environment variable.');
  }
  return apiKey;
};

// Shared recipe schema used by multiple tools
export const recipeSchema = z
  .object({
    id: z.number(),
    title: z.string(),
    description: z.string(),
    directions: z.string(),
    categories: z.array(z.string()),
    ingredients: z.array(z.string()),
    url: z.string(),
    imageUrl: z.string(),
    preparationTime: z.string().optional(),
    servings: z.number().optional(),
  })
  .describe('Detailed information about the recipe');

// Published recipes change rarely, and the same ones come back again and again: a search fetches
// each of its results in full, and a meal plan fetches the recipes it picked from those.
const RECIPE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const recipeCache = createTtlCache<z.infer<typeof recipeSchema>>({ ttlMs: RECIPE_CACHE_TTL_MS, maxEntries: 500 });

// The catalogue is walked for every meal plan -- again for each round of feedback on one -- and a
// recipe published in the last hour makes no difference to a week's plan.
const catalogCache = createTtlCache<z.infer<typeof recipeCatalogEntrySchema>[]>({
  ttlMs: 60 * 60 * 1000,
  maxEntries: 4,
});

const searchFiltersCache = createTtlCache<unknown>({ ttlMs: RECIPE_CACHE_TTL_MS, maxEntries: 1 });

/** Forgets every cached recipe, catalogue and filter list, so each test starts cold. */
export function resetCookingCachesForTest(): void {
  recipeCache.clear();
  catalogCache.clear();
  searchFiltersCache.clear();
}

/**
 * How many results a recipe search returns unless asked for more.
 *
 * Every result is a whole recipe, directions and all, that the model reads before it answers. A
 * spoken answer rarely needs more than a few, and the search used to hand over twenty-five.
 */
const DEFAULT_SEARCH_RESULTS = 10;
const MAX_SEARCH_RESULTS = 25;

// Tool to get recipe details by ID
export const getRecipeById = createTool({
  id: 'getRecipeById',
  description: 'Get detailed information about a specific recipe using its recipe ID',
  inputSchema: z.object({
    recipeId: z.string().describe('The recipe ID of the recipe to retrieve'),
  }),
  outputSchema: recipeSchema,
  execute: async (inputData) =>
    await recipeCache.get(inputData.recipeId, async () => {
      const apiKey = getApiKey();
      const url = `https://www.valdemarsro.dk/api/v2/recipes/${inputData.recipeId}?api_key=${apiKey}`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch recipe details: ${response.statusText}`);
      }

      const data = (await response.json()) as RecipeResponse;
      return mapValdemarsroRecipe(data.data);
    }),
});

// Tool to search for recipes on Valdemarsro
export const searchRecipes = createTool({
  id: 'searchRecipes',
  description:
    'Search for recipes on Valdemarsro using Danish search terms. Returns the most relevant recipes in full, ingredients and directions included.',
  inputSchema: z.object({
    searchTerm: z.string().describe('Search term in Danish for finding recipes'),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(MAX_SEARCH_RESULTS)
      .optional()
      .describe(
        `How many of the most relevant recipes to return (default ${DEFAULT_SEARCH_RESULTS}, at most ${MAX_SEARCH_RESULTS}). Only ask for more when the user wants a longer list.`,
      ),
  }),
  outputSchema: z.object({
    results: z
      .array(recipeSchema)
      .describe(
        'Array of detailed recipe information matching the search term, sorted by relevance ascending (most relevant results first)',
      ),
  }),
  execute: async (inputData, context) => {
    const apiKey = getApiKey();
    const url = `https://www.valdemarsro.dk/api/v2/search?api_key=${apiKey}`;

    const searchBody = {
      search_term: inputData.searchTerm,
    };

    const response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(searchBody),
    });

    if (!response.ok) {
      throw new Error(`Failed to search recipes: ${response.statusText}`);
    }

    const data = (await response.json()) as SearchResponse;
    const results = await Promise.all(
      data.data.result
        .slice(0, inputData.maxResults ?? DEFAULT_SEARCH_RESULTS)
        .map((item) => item.post_id.toString())
        .map(async (id) => await executeTool(getRecipeById, { recipeId: id }, context)),
    );

    return {
      results,
    };
  },
});

// Shared input for the two paginated recipe listings
const recipeListingInputSchema = z.object({
  fromDate: z.string().optional().describe('Optional from date filter'),
  amount: z.number().optional().describe('Optional maximum number of recipes to retrieve, or all recipes if not set'),
});

/**
 * How many listing pages are requested at once.
 *
 * Kept small: the aim is to stop waiting on one page before asking for the next, not to hit
 * Valdemarsro with the whole catalogue at the same moment.
 */
const PAGE_FETCH_CONCURRENCY = 6;

/** One page of a paginated listing, as {@link collectPages} needs it. */
export interface ListingPage<TItem> {
  items: TItem[];
  /** Whether the listing goes on after this page. */
  hasNext: boolean;
  /** How many more pages the listing says follow this one; only a hint for how far to read ahead. */
  pagesAfter: number;
}

/**
 * Collects a paginated listing, reading a few pages ahead instead of one page at a time.
 *
 * The result is exactly what asking for pages 0, 1, 2… one after another gives: pages are read
 * in order, and the walk stops at the first page with nothing after it, or as soon as `amount`
 * items are in. Pages fetched ahead of that point are thrown away, and so is their failure --
 * only a page the one-at-a-time walk would have asked for can fail the walk.
 *
 * A meal plan starts by walking the whole catalogue, and page after page that was one round
 * trip to Valdemarsro per page before anything else could happen.
 *
 * @param fetchPage - Fetches the page at a zero-based index
 * @param options.amount - Stop once this many items are collected
 * @param options.concurrency - Most pages in flight at once
 */
export async function collectPages<TItem>(
  fetchPage: (pageIndex: number) => Promise<ListingPage<TItem>>,
  options: { amount?: number; concurrency?: number } = {},
): Promise<TItem[]> {
  const { amount, concurrency = PAGE_FETCH_CONCURRENCY } = options;
  const collected: TItem[] = [];
  const isEnough = () => amount !== undefined && amount > 0 && collected.length >= amount;

  let nextPageIndex = 0;
  // Until the first page says otherwise, the only page known to exist is the first one.
  let pagesExpected = 1;
  let pageSize = 0;

  while (true) {
    const windowSize = readAheadWindowSize({
      concurrency,
      pagesExpected,
      itemsStillWanted: amount ? amount - collected.length : undefined,
      pageSize,
    });
    const pageIndexes = Array.from({ length: windowSize }, (_, offset) => nextPageIndex + offset);
    nextPageIndex += windowSize;

    const outcomes = await Promise.allSettled(pageIndexes.map((pageIndex) => fetchPage(pageIndex)));

    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        throw outcome.reason;
      }

      const page = outcome.value;
      collected.push(...page.items);
      pageSize ||= page.items.length;

      if (isEnough()) {
        return collected.slice(0, amount);
      }

      if (!page.hasNext) {
        return collected;
      }

      pagesExpected = page.pagesAfter;
    }
  }
}

/**
 * How many pages to ask for next: no more than may be in flight, than the listing says are left,
 * or than it takes to reach the amount wanted -- and always at least the next page, whatever the
 * listing says, since only a page itself can say it is the last.
 */
function readAheadWindowSize(options: {
  concurrency: number;
  pagesExpected: number;
  itemsStillWanted: number | undefined;
  pageSize: number;
}): number {
  const { concurrency, pagesExpected, itemsStillWanted, pageSize } = options;
  const pagesForAmount =
    itemsStillWanted !== undefined && pageSize > 0 ? Math.ceil(itemsStillWanted / pageSize) : Number.POSITIVE_INFINITY;

  return Math.max(1, Math.min(concurrency, pagesExpected, pagesForAmount));
}

/**
 * Walks the paginated recipe endpoint, mapping each recipe as it arrives.
 *
 * Mapping per page rather than afterwards keeps the caller free to decide how
 * much of a recipe it actually wants to hold on to.
 *
 * @param options - From-date filter and an optional cap on how many to collect
 * @param mapRecipe - Turns a raw API recipe into the caller's shape
 */
async function fetchRecipePages<TRecipe>(
  options: { fromDate?: string; amount?: number },
  mapRecipe: (recipe: ValdemarsroRecipe) => TRecipe,
): Promise<TRecipe[]> {
  const apiKey = getApiKey();

  async function getPage(pageIndex: number): Promise<ListingPage<TRecipe>> {
    let url = `https://www.valdemarsro.dk/api/v2/recipes/page/${pageIndex}?api_key=${apiKey}`;

    if (options.fromDate) {
      url += `&fromdate=${encodeURIComponent(options.fromDate)}`;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch recipes: ${response.statusText}`);
    }

    const page = (await response.json()) as RecipePageResponse;
    return {
      items: page.data.map(mapRecipe),
      hasNext: page.pagination.page < page.pagination.max_pages,
      pagesAfter: page.pagination.max_pages - page.pagination.page,
    };
  }

  return await collectPages(getPage, { amount: options.amount });
}

// Tool to get all recipes with pagination
export const getAllRecipes = createTool({
  id: 'getAllRecipes',
  description: 'Get all recipes from Valdemarsro with pagination support',
  inputSchema: recipeListingInputSchema,
  outputSchema: z.array(recipeSchema).describe('Array of all recipes from Valdemarsro suitable for meal planning'),
  execute: async (inputData, _context) => await fetchRecipePages(inputData, mapValdemarsroRecipe),
});

// Tool to browse the recipe catalogue without its bulk.
// `getAllRecipes` returns every ingredient and every direction of every recipe,
// which is far more than a recipe *selection* needs and more than a model's
// input token limit allows. This returns the same recipes as compact entries;
// fetch the chosen ones in full with `getRecipeById` afterwards.
export const getRecipeCatalog = createTool({
  id: 'getRecipeCatalog',
  description:
    'Get a compact catalogue of all Valdemarsro recipes (title, categories and a short summary, without ingredients or directions), suitable for choosing recipes before fetching them in full',
  inputSchema: recipeListingInputSchema,
  outputSchema: z
    .array(recipeCatalogEntrySchema)
    .describe('Array of compact recipe entries from Valdemarsro suitable for meal planning'),
  execute: async (inputData, _context) =>
    await catalogCache.get(JSON.stringify([inputData.fromDate, inputData.amount]), () =>
      fetchRecipePages(inputData, mapValdemarsroCatalogEntry),
    ),
});

// Tool to get search filters
export const getSearchFilters = createTool({
  id: 'getSearchFilters',
  description: 'Get available search filters for recipes',
  inputSchema: z.object({}),
  outputSchema: z.object({
    filters: z.unknown(),
  }),
  execute: async () => ({
    filters: await searchFiltersCache.get('', async () => {
      const apiKey = getApiKey();
      const url = `https://www.valdemarsro.dk/api/v2/search/filters?api_key=${apiKey}`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch search filters: ${response.statusText}`);
      }

      return await response.json();
    }),
  }),
});

// Export all cooking tools
export const cookingTools = {
  searchRecipes,
  getRecipeById,
  getAllRecipes,
  getRecipeCatalog,
  getSearchFilters,
};

function mapValdemarsroRecipe(recipe: ValdemarsroRecipe) {
  const ingredients = recipe.ingredients
    .filter((item) => item.ingrediens?.name)
    .map((item) => {
      const amount = item.maengde || '';
      const unit = item.maengde ? item.enhed || '' : '';
      const name = item.ingrediens?.name || '';
      const extra = item.tekst || '';
      return `${amount} ${unit} ${name} ${extra}`.trim();
    })
    .filter((item) => !!item);

  // Extract preparation time from tid object (total time in minutes as string)
  const preparationTime = recipe.fields.tid?.i_alt;

  // Extract servings from personer_maengde object (antal as number).
  // The field is free text, so a value like "4-6" parses fine but "efter behov"
  // yields NaN — which the schema rejects, taking the whole run down with it.
  const parsedServings = recipe.fields.personer_maengde?.antal
    ? parseInt(recipe.fields.personer_maengde.antal, 10)
    : undefined;
  const servings = Number.isFinite(parsedServings) ? parsedServings : undefined;

  return {
    id: recipe.recipe_id,
    title: recipe.title,
    description: recipe.description,
    directions: recipe.directions,
    categories: recipe.categories.map((cat) => cat.name),
    ingredients,
    url: recipe.url,
    imageUrl: recipe.media,
    preparationTime,
    servings,
  };
}

function mapValdemarsroCatalogEntry(recipe: ValdemarsroRecipe) {
  const { id, title, categories, description, preparationTime, servings } = mapValdemarsroRecipe(recipe);

  return {
    id,
    title,
    categories,
    summary: toPlainTextSummary(description),
    preparationTime,
    servings,
  };
}
