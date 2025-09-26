import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

// Schema for meal plan structure
const mealPlanSchema = z.object({
  mealplan: z.array(z.object({
    days: z.array(z.string().describe('Weekday names in Danish')),
    recipe: z.object({
      title: z.string(),
      ingredients: z.array(z.string()),
      directions: z.array(z.string()),
      imageUrl: z.string(),
      url: z.string(),
    }).nullable(),
  })),
});

// Step to get recipe data for meal planning
const getRecipesForMealPlanning = createStep({
  id: 'get-recipes-for-meal-planning',
  description: 'Fetches dinner recipes from storage for meal planning',
  inputSchema: z.object({
    preferences: z.string().optional(),
    limit: z.number().optional().default(10),
  }),
  outputSchema: z.object({
    recipes: z.array(z.object({
      id: z.number(),
      title: z.string(),
      description: z.string(),
      categories: z.array(z.string()),
      ingredients: z.array(z.string()),
      preparationTime: z.string().optional(),
      lastUsedInMealplan: z.string().optional(),
    })),
  }),
  execute: async ({ mastra, inputData }) => {
    // This would typically query a database
    // For now, we'll use the cooking agent to get recipes
    const agent = mastra?.getAgent('cookingAgent');
    if (!agent) {
      throw new Error('Cooking agent not found');
    }

    // In a real implementation, this would query the database for recipes
    // that haven't been used in meal plans recently
    const response = await agent.stream([
      {
        role: 'user',
        content: `Get ${inputData.limit} dinner recipes that are suitable for meal planning. Focus on "Aftensmad" (dinner) category recipes. Avoid weird soups.`,
      },
    ]);

    let recipeData = '';
    for await (const chunk of response.textStream) {
      recipeData += chunk;
    }

    // Parse the response - in a real implementation, this would be structured data from database
    return {
      recipes: [], // Would be populated from database query
    };
  },
});

// Step to select recipes for meal plan
const selectMealPlanRecipes = createStep({
  id: 'select-meal-plan-recipes',
  description: 'Selects optimal recipes for the weekly meal plan',
  inputSchema: z.object({
    recipes: z.array(z.object({
      id: z.number(),
      title: z.string(),
      description: z.string(),
      categories: z.array(z.string()),
      ingredients: z.array(z.string()),
      preparationTime: z.string().optional(),
      lastUsedInMealplan: z.string().optional(),
    })),
  }),
  outputSchema: z.object({
    selectedRecipeIds: z.array(z.number()),
  }),
  execute: async ({ inputData, mastra }) => {
    const agent = mastra?.getAgent('cookingAgent');
    if (!agent) {
      throw new Error('Cooking agent not found');
    }

    const prompt = `
Based on the following recipes, select 2 recipes for a weekly meal plan. Each recipe should provide enough food for 3 days for 2 people.

Consider:
- Recipes that share ingredients (bonus points)
- Short preparation time (bonus points)
- Healthy options (bonus points)
- Avoid weird soups like "burgersuppe", "tacosuppe", "lasagnesuppe"

Available recipes:
${JSON.stringify(inputData.recipes, null, 2)}

Respond with only the recipe IDs as a JSON array of numbers.
`;

    const response = await agent.stream([
      {
        role: 'user',
        content: prompt,
      },
    ]);

    let selectionData = '';
    for await (const chunk of response.textStream) {
      selectionData += chunk;
    }

    // Parse the JSON response to get selected recipe IDs
    try {
      const selectedIds = JSON.parse(selectionData.trim());
      return { selectedRecipeIds: Array.isArray(selectedIds) ? selectedIds : [] };
    } catch (error) {
      throw new Error(`Failed to parse recipe selection: ${error}`);
    }
  },
});

// Step to generate detailed meal plan
const generateMealPlan = createStep({
  id: 'generate-meal-plan',
  description: 'Generates a detailed weekly meal plan with recipes and scheduling',
  inputSchema: z.object({
    selectedRecipeIds: z.array(z.number()),
  }),
  outputSchema: mealPlanSchema,
  execute: async ({ inputData, mastra }) => {
    const agent = mastra?.getAgent('cookingAgent');
    if (!agent) {
      throw new Error('Cooking agent not found');
    }

    const prompt = `
Create a detailed weekly meal plan using the selected recipe IDs: ${inputData.selectedRecipeIds.join(', ')}

For each recipe:
1. Get full recipe details including ingredients and directions
2. Scale ingredients for 6 people (2 people × 3 days)
3. Assign days of the week in Danish
4. Consider ingredient expiry (use meat/dairy first)

Format the response as JSON matching this schema:
{
  "mealplan": [
    {
      "days": ["mandag", "tirsdag", "onsdag"],
      "recipe": {
        "title": "Recipe Title",
        "ingredients": ["ingredient 1", "ingredient 2"],
        "directions": ["step 1", "step 2"],
        "imageUrl": "https://...",
        "url": "https://..."
      }
    }
  ]
}
`;

    const response = await agent.stream([
      {
        role: 'user',
        content: prompt,
      },
    ]);

    let mealPlanData = '';
    for await (const chunk of response.textStream) {
      mealPlanData += chunk;
    }

    // Parse and validate the meal plan response
    try {
      const mealPlan = JSON.parse(mealPlanData.trim());
      return mealPlanSchema.parse(mealPlan);
    } catch (error) {
      throw new Error(`Failed to parse meal plan: ${error}`);
    }
  },
});

// Step to generate HTML email for meal plan
const generateMealPlanEmail = createStep({
  id: 'generate-meal-plan-email',
  description: 'Generates HTML email content for the meal plan',
  inputSchema: mealPlanSchema,
  outputSchema: z.object({
    htmlContent: z.string(),
    subject: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    const agent = mastra?.getAgent('cookingAgent');
    if (!agent) {
      throw new Error('Cooking agent not found');
    }

    const prompt = `
Generate HTML email content for this meal plan in Danish:

${JSON.stringify(inputData, null, 2)}

For each recipe, include:
1. Large title as link to recipe URL (center-aligned)
2. Days the recipe is for (center-aligned)
3. Recipe image as link (center-aligned)
4. Meat/dairy ingredients needing preparation (white font, left-aligned)
5. Vegetable/fruit ingredients needing preparation (clear color, left-aligned)
6. Other ingredients with purpose notes (clear color, left-aligned)
7. Cooking directions in bullet format (clear color, left-aligned)

Add proper spacing and use colors compatible with light/dark themes.
Include "save X g for later" notes for ingredients used in multiple recipes.
Make HTML email-client compatible with inline styles.

Return JSON with "htmlContent" and "subject" fields.
`;

    const response = await agent.stream([
      {
        role: 'user',
        content: prompt,
      },
    ]);

    let emailData = '';
    for await (const chunk of response.textStream) {
      emailData += chunk;
    }

    try {
      const emailResult = JSON.parse(emailData.trim());
      return {
        htmlContent: emailResult.htmlContent || emailData,
        subject: emailResult.subject || 'Nyt forslag til madplan',
      };
    } catch (error) {
      // If parsing fails, use the raw response as HTML
      return {
        htmlContent: emailData,
        subject: 'Nyt forslag til madplan',
      };
    }
  },
});

// Final step to combine results
const combineResults = createStep({
  id: 'combine-results',
  description: 'Combines meal plan and email content into final output',
  inputSchema: z.object({
    htmlContent: z.string(),
    subject: z.string(),
  }),
  outputSchema: z.object({
    emailContent: z.object({
      htmlContent: z.string(),
      subject: z.string(),
    }),
  }),
  execute: async ({ inputData, getStepResult }) => {
    const mealPlan = getStepResult(generateMealPlan);
    
    return {
      emailContent: {
        htmlContent: inputData.htmlContent,
        subject: inputData.subject,
      },
    };
  },
});

// Main weekly meal planning workflow
export const weeklyMealPlanningWorkflow = createWorkflow({
  id: 'weekly-meal-planning-workflow',
  inputSchema: z.object({
    preferences: z.string().optional(),
    limit: z.number().optional().default(100),
  }),
  outputSchema: z.object({
    emailContent: z.object({
      htmlContent: z.string(),
      subject: z.string(),
    }),
  }),
})
  .then(getRecipesForMealPlanning)
  .then(selectMealPlanRecipes)
  .then(generateMealPlan)
  .then(generateMealPlanEmail)
  .then(combineResults);

// Recipe indexing workflow (equivalent to the quarterly recipe rebuild in n8n)
const fetchAllRecipesStep = createStep({
  id: 'fetch-all-recipes',
  description: 'Fetches all recipes from Valdemarsro API',
  inputSchema: z.object({}),
  outputSchema: z.object({
    totalRecipes: z.number(),
    message: z.string(),
  }),
  execute: async ({ mastra }) => {
    const agent = mastra?.getAgent('cookingAgent');
    if (!agent) {
      throw new Error('Cooking agent not found');
    }

    // This would fetch all recipes and store them in the database with embeddings
    const response = await agent.stream([
      {
        role: 'user',
        content: 'Fetch all recipes from Valdemarsro and prepare them for indexing. Start from page 0 and continue until all pages are processed.',
      },
    ]);

    let indexingData = '';
    for await (const chunk of response.textStream) {
      indexingData += chunk;
    }

    return {
      totalRecipes: 0, // Would be actual count from indexing process
      message: 'Recipe indexing completed successfully',
    };
  },
});

// Commit the workflows
weeklyMealPlanningWorkflow.commit();