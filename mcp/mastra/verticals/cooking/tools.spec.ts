import { beforeAll, describe, expect, it } from 'bun:test';
import { cookingTools } from './tools';

// Type guard to check if result is a validation error
function isValidationError(result: any): result is { error: true; message: string } {
  return result && result.error === true;
}

describe('Cooking Tools Integration Tests', () => {
  beforeAll(() => {
    // Verify API key is configured
    if (!process.env.HEY_JARVIS_VALDEMARSRO_API_KEY) {
      throw new Error('HEY_JARVIS_VALDEMARSRO_API_KEY environment variable is required for cooking tools tests');
    }
  });

  describe('getRecipeById', () => {
    it('should fetch a recipe by ID and validate schema', async () => {
      // Using a known recipe ID from Valdemarsro
      const result = await cookingTools.getRecipeById.execute({ recipeId: '51796' });

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      // Validate structure
      expect(result).toBeDefined();
      expect(typeof result.id).toBe('number');
      expect(typeof result.title).toBe('string');
      expect(typeof result.description).toBe('string');
      expect(typeof result.directions).toBe('string');
      expect(Array.isArray(result.categories)).toBe(true);
      expect(Array.isArray(result.ingredients)).toBe(true);
      expect(typeof result.url).toBe('string');
      expect(typeof result.imageUrl).toBe('string');

      // Validate optional fields have correct types when present
      if (result.preparationTime !== undefined) {
        expect(typeof result.preparationTime).toBe('string');
      }
      if (result.servings !== undefined) {
        expect(typeof result.servings).toBe('number');
      }

      console.log('✅ Recipe fetched successfully:', result.title);
      console.log('   - preparationTime type:', typeof result.preparationTime, '=', result.preparationTime);
      console.log('   - servings type:', typeof result.servings, '=', result.servings);
    }, 30000);
  });

  describe('searchRecipes', () => {
    it('should search for recipes and validate schema', async () => {
      const result = await cookingTools.searchRecipes.execute({ searchTerm: 'kylling' });

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      // Validate structure
      expect(result).toBeDefined();
      expect(result.results).toBeDefined();
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.results.length).toBeGreaterThan(0);

      // Validate first result
      const firstRecipe = result.results[0];
      expect(typeof firstRecipe.id).toBe('number');
      expect(typeof firstRecipe.title).toBe('string');
      expect(typeof firstRecipe.description).toBe('string');
      expect(typeof firstRecipe.directions).toBe('string');
      expect(Array.isArray(firstRecipe.categories)).toBe(true);
      expect(Array.isArray(firstRecipe.ingredients)).toBe(true);
      expect(typeof firstRecipe.url).toBe('string');
      expect(typeof firstRecipe.imageUrl).toBe('string');

      // Validate optional fields
      if (firstRecipe.preparationTime !== undefined) {
        expect(typeof firstRecipe.preparationTime).toBe('string');
      }
      if (firstRecipe.servings !== undefined) {
        expect(typeof firstRecipe.servings).toBe('number');
      }

      console.log(`✅ Found ${result.results.length} recipes for "kylling"`);
      console.log('   First recipe:', firstRecipe.title);
      console.log('   - preparationTime type:', typeof firstRecipe.preparationTime, '=', firstRecipe.preparationTime);
      console.log('   - servings type:', typeof firstRecipe.servings, '=', firstRecipe.servings);
    }, 30000);
  });

  describe('getAllRecipes', () => {
    it('should fetch all recipes and validate schema', async () => {
      // Fetch recipes from last 30 days to limit results
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const fromDate = thirtyDaysAgo.toISOString().split('T')[0];

      const result = await cookingTools.getAllRecipes.execute({ fromDate });

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      // Validate structure
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);

      // Validate first recipe
      const firstRecipe = result[0];
      expect(typeof firstRecipe.id).toBe('number');
      expect(typeof firstRecipe.title).toBe('string');
      expect(typeof firstRecipe.description).toBe('string');
      expect(typeof firstRecipe.directions).toBe('string');
      expect(Array.isArray(firstRecipe.categories)).toBe(true);
      expect(Array.isArray(firstRecipe.ingredients)).toBe(true);
      expect(typeof firstRecipe.url).toBe('string');
      expect(typeof firstRecipe.imageUrl).toBe('string');

      // Check all recipes for type consistency
      const preparationTimeTypes = new Set<string>();
      const servingsTypes = new Set<string>();

      for (const recipe of result) {
        if (recipe.preparationTime !== undefined) {
          preparationTimeTypes.add(typeof recipe.preparationTime);
        }
        if (recipe.servings !== undefined) {
          servingsTypes.add(typeof recipe.servings);
        }
      }

      console.log(`✅ Fetched ${result.length} recipes from last 30 days`);
      console.log('   First recipe:', firstRecipe.title);
      console.log('   - preparationTime types found:', Array.from(preparationTimeTypes));
      console.log('   - servings types found:', Array.from(servingsTypes));

      // Log problematic recipes if any
      const problematicRecipes = result.filter(
        (r) =>
          (r.preparationTime !== undefined && typeof r.preparationTime !== 'string') ||
          (r.servings !== undefined && typeof r.servings !== 'number'),
      );

      if (problematicRecipes.length > 0) {
        console.log(`\n⚠️  Found ${problematicRecipes.length} recipes with type mismatches:`);
        problematicRecipes.slice(0, 5).forEach((recipe) => {
          console.log(`   - ${recipe.title}`);
          console.log(
            `     preparationTime: ${typeof recipe.preparationTime} = ${JSON.stringify(recipe.preparationTime)}`,
          );
          console.log(`     servings: ${typeof recipe.servings} = ${JSON.stringify(recipe.servings)}`);
        });
      }

      // Validate types
      expect(preparationTimeTypes.size).toBeLessThanOrEqual(1);
      expect(servingsTypes.size).toBeLessThanOrEqual(1);
      if (preparationTimeTypes.size > 0) {
        expect(Array.from(preparationTimeTypes)[0]).toBe('string');
      }
      if (servingsTypes.size > 0) {
        expect(Array.from(servingsTypes)[0]).toBe('number');
      }
    }, 60000);
  });

  describe('getSearchFilters', () => {
    it('should fetch search filters', async () => {
      const result = await cookingTools.getSearchFilters.execute({});

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      // Validate structure
      expect(result).toBeDefined();
      expect(result.filters).toBeDefined();

      console.log('✅ Search filters fetched successfully');
      console.log('   Available filters:', Object.keys(result.filters));
    }, 30000);
  });
});
