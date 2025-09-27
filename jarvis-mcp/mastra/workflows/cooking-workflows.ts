import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { RuntimeContext } from '@mastra/core/runtime-context';
import { getAllRecipes } from '../tools/cooking-tools';

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

// Step to get recipe data for meal planning using the getAllRecipes tool directly
const getRecipesForMealPlanning = createStep({
    id: 'get-recipes-for-meal-planning',
    description: 'Fetches all recipes and filters for dinner recipes suitable for meal planning',
    inputSchema: z.any(),
    outputSchema: z.object({
        recipes: z.array(z.object({
            id: z.number(),
            title: z.string(),
            description: z.string(),
            categories: z.array(z.string()),
            ingredients: z.array(z.string()),
            preparationTime: z.string().optional(),
        })),
    }),
    execute: async ({ runtimeContext, mastra, suspend, writer }) => {
        // Use the getAllRecipes tool through the proper execution context
        const allRecipes = await getAllRecipes.execute({
            context: {},
            runtimeContext,
            mastra,
            suspend,
            writer
        });

        // Filter recipes for dinner/evening meals (looking for "Aftensmad" or similar categories)
        const dinnerCategories = ['aftensmad'];
        const dinnerRecipes = allRecipes.filter(recipe => {
            return recipe.categories.some(category =>
                dinnerCategories.some(dinnerCat =>
                    category.toLowerCase().includes(dinnerCat)
                )
            );
        });

        return {
            recipes: dinnerRecipes
        };
    },
});

// Combined step that uses specialized agents for selection and meal plan generation
const selectAndPlanMeals = createStep({
    id: 'select-and-plan-meals',
    description: 'Uses specialized agents to select recipes and generate meal plan',
    inputSchema: z.object({
        recipes: z.array(z.object({
            id: z.number(),
            title: z.string(),
            description: z.string(),
            categories: z.array(z.string()),
            ingredients: z.array(z.string()),
            preparationTime: z.string().optional(),
        })),
    }),
    outputSchema: mealPlanSchema,
    execute: async ({ inputData, mastra }) => {
        // Step 1: Use meal plan selector agent to select optimal recipes
        const selectorAgent = mastra?.getAgent('mealPlanSelector');
        if (!selectorAgent) {
            throw new Error('Meal plan selector agent not found');
        }

        let prompt = `Select 2 optimal recipes for a weekly meal plan from the following options:

${JSON.stringify(inputData.recipes, null, 2)}`;

        const selectionResponse = await selectorAgent.streamVNext([
            {
                role: 'user',
                content: prompt,
            },
        ], {
            structuredOutput: {
                schema: z.object({
                    selectedRecipeIds: z.array(z.number()).describe('Array of selected recipe IDs for the meal plan'),
                })
            }
        });

        // Get the structured result directly from the response
        const selectionResult = await selectionResponse.object;
        console.log('selectionResult', selectionResult);
        
        const selectedRecipes = inputData.recipes.filter(recipe =>
            selectionResult.selectedRecipeIds.includes(recipe.id)
        );

        // Step 2: Use meal plan generator agent to create the detailed meal plan
        const generatorAgent = mastra?.getAgent('mealPlanGenerator');
        if (!generatorAgent) {
            throw new Error('Meal plan generator agent not found');
        }

        const planResponse = await generatorAgent.streamVNext([
            {
                role: 'user',
                content: `Create a detailed weekly meal plan using these selected recipes:\n\n${JSON.stringify(selectedRecipes, null, 2)}\n\nGenerate the complete meal plan with proper scheduling and scaled ingredients.`,
            },
        ], {
            structuredOutput: {
                schema: mealPlanSchema
            }
        });

        // Get the structured result directly from the response
        const mealPlan = await planResponse.object;
        console.log('mealPlan', mealPlan);
        return mealPlan;
    },
});

// Step to generate HTML email using specialized formatter agent
const generateMealPlanEmail = createStep({
    id: 'generate-meal-plan-email',
    description: 'Generates HTML email using the specialized email formatter agent',
    inputSchema: mealPlanSchema,
    outputSchema: z.object({
        htmlContent: z.string(),
        subject: z.string(),
    }),
    execute: async ({ inputData, mastra }) => {
        const formatterAgent = mastra?.getAgent('mealPlanEmailFormatter');
        if (!formatterAgent) {
            throw new Error('Email formatter agent not found');
        }

        const prompt = `Format this meal plan into a professional HTML email:\n\n${JSON.stringify(inputData, null, 2)}`;

        const response = await formatterAgent.streamVNext([
            {
                role: 'user',
                content: prompt,
            },
        ], {
            structuredOutput: {
                schema: z.string().describe('HTML content of the meal plan email without any additional text or markdown')
            }
        });

        let emailData = '';
        for await (const chunk of response.textStream) {
            emailData += chunk;
        }

        return {
            htmlContent: emailData,
            subject: 'Nyt forslag til madplan',
        };
    },
});

// Main weekly meal planning workflow using specialized agents
export const weeklyMealPlanningWorkflow = createWorkflow({
    id: 'weekly-meal-planning-workflow',
    inputSchema: z.any(),
    outputSchema: z.object({
        htmlContent: z.string(),
        subject: z.string(),
    }),
})
    .then(getRecipesForMealPlanning)
    .then(selectAndPlanMeals)
    .then(generateMealPlanEmail)
    .commit();