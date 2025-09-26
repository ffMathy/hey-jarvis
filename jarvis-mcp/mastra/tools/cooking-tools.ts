import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

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

interface SearchResponse {
  results: Array<{
    post_id: number;
    // Additional search result fields
  }>;
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
  const apiKey = process.env.VALDEMARSRO_API_KEY;
  if (!apiKey) {
    throw new Error('Valdemarsro API key not found. Please set VALDEMARSRO_API_KEY environment variable.');
  }
  return apiKey;
};

// Tool to search for recipes on Valdemarsro
export const searchRecipes = createTool({
  id: 'search-recipes',
  description: 'Search for recipes on Valdemarsro using Danish search terms',
  inputSchema: z.object({
    searchTerm: z.string().describe('Search term in Danish for finding recipes'),
    ingredients: z.array(z.number()).optional().describe('Array of ingredient IDs to filter by'),
    favoritesOnly: z.boolean().optional().describe('Whether to search only favorite recipes'),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      postId: z.number(),
      // Additional fields will be added based on actual API response
    })),
  }),
  execute: async ({ context }) => {
    const apiKey = getApiKey();
    const url = 'https://www.valdemarsro.dk/api/v2/search';
    
    const searchBody = {
      search_term: context.searchTerm,
      ...(context.ingredients && { ingredients: context.ingredients }),
      ...(context.favoritesOnly !== undefined && { favoritesOnly: context.favoritesOnly }),
    };
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(searchBody),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to search recipes: ${response.statusText}`);
    }
    
    const data = (await response.json()) as SearchResponse;
    
    return {
      results: data.results.map(item => ({
        postId: item.post_id,
      })),
    };
  },
});

// Tool to get recipe details by ID
export const getRecipeDetails = createTool({
  id: 'get-recipe-details',
  description: 'Get detailed information about a specific recipe using its post_id',
  inputSchema: z.object({
    recipeId: z.number().describe('The post_id of the recipe to retrieve'),
  }),
  outputSchema: z.object({
    recipe: z.object({
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
    }),
  }),
  execute: async ({ context }) => {
    const apiKey = getApiKey();
    const url = `https://www.valdemarsro.dk/api/v2/recipes/${context.recipeId}?api_key=${apiKey}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch recipe details: ${response.statusText}`);
    }
    
    const data = (await response.json()) as Recipe;
    
    // Process ingredients into readable format
    const ingredients = data.ingredients
      .filter(item => item.ingrediens?.name)
      .map(item => {
        const amount = item.maengde || '';
        const unit = item.maengde ? item.enhed || '' : '';
        const name = item.ingrediens?.name || '';
        const extra = item.tekst || '';
        return `${amount} ${unit} ${name} ${extra}`.trim();
      });
    
    return {
      recipe: {
        id: data.recipe_id,
        title: data.title,
        description: data.description,
        directions: data.directions,
        categories: data.categories.map(cat => cat.name),
        ingredients,
        url: data.url,
        imageUrl: data.media,
        preparationTime: data.fields.tid,
        servings: data.fields.personer_maengde,
      },
    };
  },
});

// Tool to get all recipes with pagination
export const getAllRecipes = createTool({
  id: 'get-all-recipes',
  description: 'Get all recipes from Valdemarsro with pagination support',
  inputSchema: z.object({
    page: z.number().optional().default(0).describe('Page number to retrieve (starts from 0)'),
    fromDate: z.string().optional().describe('Filter recipes from a specific date'),
  }),
  outputSchema: z.object({
    recipes: z.array(z.object({
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
    })),
    pagination: z.object({
      currentPage: z.number(),
      maxPages: z.number(),
      hasNext: z.boolean(),
    }),
  }),
  execute: async ({ context }) => {
    const apiKey = getApiKey();
    let url = `https://www.valdemarsro.dk/api/v2/recipes/page/${context.page}?api_key=${apiKey}`;
    
    if (context.fromDate) {
      url += `&fromdate=${encodeURIComponent(context.fromDate)}`;
    }
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch recipes: ${response.statusText}`);
    }
    
    const data = (await response.json()) as RecipePageResponse;
    
    const recipes = data.data.map(recipe => {
      const ingredients = recipe.ingredients
        .filter(item => item.ingrediens?.name)
        .map(item => {
          const amount = item.maengde || '';
          const unit = item.maengde ? item.enhed || '' : '';
          const name = item.ingrediens?.name || '';
          const extra = item.tekst || '';
          return `${amount} ${unit} ${name} ${extra}`.trim();
        });
      
      return {
        id: recipe.recipe_id,
        title: recipe.title,
        description: recipe.description,
        directions: recipe.directions,
        categories: recipe.categories.map(cat => cat.name),
        ingredients,
        url: recipe.url,
        imageUrl: recipe.media,
        preparationTime: recipe.fields.tid,
        servings: recipe.fields.personer_maengde,
      };
    });
    
    return {
      recipes,
      pagination: {
        currentPage: data.pagination.page,
        maxPages: data.pagination.max_pages,
        hasNext: data.pagination.page < data.pagination.max_pages,
      },
    };
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
  getRecipeDetails,
  getAllRecipes,
  getSearchFilters,
};