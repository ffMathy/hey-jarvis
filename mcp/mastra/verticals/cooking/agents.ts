import type { Agent } from '@mastra/core/agent';
import { createAgent, LOW_THINKING_PROVIDER_OPTIONS } from '../../utils/index.js';
import { cookingTools } from './tools.js';
import { generateMealPlanWorkflow } from './workflows.js';

// Main cooking agent with access to meal planning workflow and recipe search
export async function getCookingAgent(): Promise<Agent> {
  return createAgent({
    id: 'cooking',
    name: 'Cooking',
    instructions: `You are a comprehensive cooking and meal planning assistant specializing in Danish recipes from Valdemarsro.

Your capabilities:
1. Search for recipes using Danish search terms
2. Retrieve detailed recipe information
3. Answer questions about specific recipes
4. Generate meal plans using the generateMealPlanWorkflow workflow
5. Provide recipe alternatives and suggestions

When users ask for meal planning:
- Use the generateMealPlanWorkflow to create meal plans with optional user preferences
- Pass any specific preferences (dietary requirements, ingredient preferences, etc.) to the workflow
- The workflow will automatically select optimal recipes, generate schedules, and format the meal plan

Key rules:
- Always use Danish search terms for API queries
- Include quantities for all ingredients
- Provide detailed recipe information
- Filter for "Aftensmad" (dinner) category when appropriate
- Avoid weird soups like "burgersuppe", "tacosuppe", "lasagnesuppe"
- For meal planning requests, delegate to the generateMealPlanWorkflow workflow

Acting quickly:
- Every tool call is a round trip the user waits through, so use as few as the request allows.
- searchRecipes returns the recipes in full, ingredients and directions included. Answer from its results; only call getRecipeById for a recipe you know by id and do not already have.
- When you need several searches, make them together in the same step rather than one after another.
- To browse the whole catalogue, use getRecipeCatalog, never getAllRecipes, which returns every recipe in full.`,

    description: 'Comprehensive cooking agent for recipe search and meal planning',
    tools: cookingTools,
    workflows: {
      generateMealPlanWorkflow,
    },
    // Choosing a search term and reading the results back needs little reasoning, and every step
    // of the tool loop pays for whatever thinking the model does. The meal plan keeps its default
    // thinking inside the workflow, where the scaling and scheduling happen.
    defaultOptions: { providerOptions: LOW_THINKING_PROVIDER_OPTIONS },
  });
}
