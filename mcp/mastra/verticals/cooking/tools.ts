import { z } from 'zod';
import { createTool } from '../../utils/tool-factory';

// Interface for Valdemarsro Recipe API responses
interface Recipe {
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
    personer_maengde?: number;
    tid?: string;
  };
}

interface RecipeResponse {
  data: Recipe;
}

interface SearchResponse {
  data: {
    result: Array<{
      post_id: number;
    }>;
  };
}

interface RecipePageResponse {
  data: Recipe[];
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

// Tool to get recipe details by ID
export const getRecipeById = createTool({
  id: 'get-recipe-by-id',
  description: 'Get detailed information about a specific recipe using its recipe ID',
  inputSchema: z.object({
    recipeId: z.string().describe('The recipe ID of the recipe to retrieve'),
  }),
  outputSchema: z
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
    .describe('Detailed information about the recipe'),
  execute: async ({ context }) => {
    const apiKey = getApiKey();
    const url = `https://www.valdemarsro.dk/api/v2/recipes/${context.recipeId}?api_key=${apiKey}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch recipe details: ${response.statusText}`);
    }

    const data = (await response.json()) as RecipeResponse;
    return mapValdemarsroRecipe(data.data);
  },
});

// Tool to search for recipes on Valdemarsro
export const searchRecipes = createTool({
  id: 'search-recipes',
  description: 'Search for recipes on Valdemarsro using Danish search terms',
  inputSchema: z.object({
    searchTerm: z.string().describe('Search term in Danish for finding recipes'),
  }),
  outputSchema: z.object({
    results: z
      .array(getRecipeById.outputSchema)
      .describe(
        'Array of detailed recipe information matching the search term, sorted by relevance ascending (most relevant results first)',
      ),
  }),
  execute: async ({ context, runtimeContext, mastra, suspend, writer }) => {
    const apiKey = getApiKey();
    const url = `https://www.valdemarsro.dk/api/v2/search?api_key=${apiKey}`;

    const searchBody = {
      search_term: context.searchTerm,
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
        .slice(0, 25)
        .map((item) => item.post_id.toString())
        .map(
          async (id) =>
            await getRecipeById.execute({
              context: { recipeId: id },
              runtimeContext,
              mastra,
              suspend,
              writer,
            }),
        ),
    );

    return {
      results: results,
    };
  },
});

// Tool to get all recipes with pagination
export const getAllRecipes = createTool({
  id: 'get-all-recipes',
  description: 'Get all recipes from Valdemarsro with pagination support',
  inputSchema: z.any(),
  // Output schema is an array of recipes
  outputSchema: z
    .array(getRecipeById.outputSchema)
    .describe('Array of all recipes from Valdemarsro suitable for meal planning'),
  execute: async ({ context }) => {
    async function getPage(page: number) {
      const apiKey = getApiKey();
      let url = `https://www.valdemarsro.dk/api/v2/recipes/page/${page}?api_key=${apiKey}`;

      if (context.fromDate) {
        url += `&fromdate=${encodeURIComponent(context.fromDate)}`;
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch recipes: ${response.statusText}`);
      }

      const data = (await response.json()) as RecipePageResponse;
      return data;
    }

    const allRecipes = [];

    let currentPage = 0;
    let hasNext = true;
    while (hasNext) {
      const page = await getPage(currentPage++);

      const recipes = page.data.map(mapValdemarsroRecipe);
      allRecipes.push(...recipes);

      hasNext = page.pagination.page < page.pagination.max_pages;
    }

    return allRecipes;
  },
});

// Tool to get search filters
export const getSearchFilters = createTool({
  id: 'get-search-filters',
  description: 'Get available search filters for recipes',
  inputSchema: z.object({}),
  outputSchema: z.object({
    filters: z.any(), // Will be defined based on actual API response
  }),
  execute: async () => {
    const apiKey = getApiKey();
    const url = `https://www.valdemarsro.dk/api/v2/search/filters?api_key=${apiKey}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch search filters: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      filters: data,
    };
  },
});

// Export all cooking tools
export const cookingTools = {
  searchRecipes,
  getRecipeById,
  getAllRecipes,
  getSearchFilters,
};

function mapValdemarsroRecipe(recipe: Recipe) {
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

  return {
    id: recipe.recipe_id,
    title: recipe.title,
    description: recipe.description,
    directions: recipe.directions,
    categories: recipe.categories.map((cat) => cat.name),
    ingredients,
    url: recipe.url,
    imageUrl: recipe.media,
    preparationTime: recipe.fields.tid,
    servings: recipe.fields.personer_maengde,
  };
}
