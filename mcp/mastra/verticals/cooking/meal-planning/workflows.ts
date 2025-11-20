import { z } from 'zod';
import { createAgentStep, createStep, createToolStep, createWorkflow } from '../../../utils/workflow-factory.js';
import { getAllRecipes } from '../tools.js';

// Step 1: Get all recipes using createToolStep
const getRecipesForMealPlanning = createToolStep({
  id: 'get-recipes-for-meal-planning',
  description: 'Fetches all recipes and filters for dinner recipes suitable for meal planning',
  tool: getAllRecipes,
  inputSchema: z.undefined()
});

// Store recipes in workflow state
const storeRecipes = createStep({
  id: 'store-recipes',
  description: 'Stores recipes in workflow state',
  inputSchema: getAllRecipes.outputSchema,
  outputSchema: z.object({}),
  execute: async ({ context, workflow }) => {
    workflow.setState({
      recipes: context,
    });
    return {};
  },
});

// Step 2: Generate complete meal plan using workflow state
const generateCompleteMealPlan = createAgentStep({
  id: 'generate-complete-meal-plan',
  description: 'Uses meal plan agents to select recipes and generate complete meal plan',
  agentName: 'mealPlanGenerator',
  inputSchema: z.object({}),
  outputSchema: z.object({
    mealplan: z.array(
      z.object({
        days: z.array(z.string().describe('Weekday names in Danish')),
        recipe: z
          .object({
            title: z.string(),
            ingredients: z.array(z.string()),
            directions: z.array(z.string()),
            imageUrl: z.string(),
            url: z.string(),
          })
          .nullable(),
      }),
    ),
  }),
  prompt: ({ workflow }) => {
    const state = workflow.state;
    return `Create a detailed weekly meal plan by first selecting 2 optimal recipes from the following options, then generating a complete meal plan with proper scheduling and scaled ingredients:

${JSON.stringify(state.recipes, null, 2)}

Focus on dinner/evening meals (look for "aftensmad" or similar categories). Generate the complete meal plan with proper scheduling.`;
  },
});

// Store meal plan in workflow state
const storeMealPlan = createStep({
  id: 'store-meal-plan',
  description: 'Stores meal plan in workflow state',
  inputSchema: z.object({
    mealplan: z.array(
      z.object({
        days: z.array(z.string()),
        recipe: z
          .object({
            title: z.string(),
            ingredients: z.array(z.string()),
            directions: z.array(z.string()),
            imageUrl: z.string(),
            url: z.string(),
          })
          .nullable(),
      }),
    ),
  }),
  outputSchema: z.object({}),
  execute: async ({ context, workflow }) => {
    workflow.setState({
      ...workflow.state,
      mealplan: context.mealplan,
    });
    return {};
  },
});

// Step 3: Generate HTML email using workflow state
const generateMealPlanEmail = createAgentStep({
  id: 'generate-meal-plan-email',
  description: 'Generates HTML email using the specialized email formatter agent',
  agentName: 'mealPlanEmailFormatter',
  inputSchema: z.object({}),
  outputSchema: z.object({
    htmlContent: z.string(),
    subject: z.string(),
  }),
  prompt: ({ workflow }) => {
    const state = workflow.state;
    return `Format this meal plan into a professional HTML email:

${JSON.stringify(state.mealplan, null, 2)}

Return only the HTML content without any additional text or markdown.`;
  },
});

// Main weekly meal planning workflow using workflow state
export const weeklyMealPlanningWorkflow = createWorkflow({
  id: 'weekly-meal-planning-workflow',
  inputSchema: z.undefined(),
  outputSchema: z.object({
    htmlContent: z.string(),
    subject: z.string(),
  }),
})
  .then(getRecipesForMealPlanning)
  .then(storeRecipes)
  .then(generateCompleteMealPlan)
  .then(storeMealPlan)
  .then(generateMealPlanEmail)
  .commit();
