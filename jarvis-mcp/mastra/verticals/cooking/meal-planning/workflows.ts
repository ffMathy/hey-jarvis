import { createWorkflow, createToolStep, createAgentStep } from '../../../utils/workflow-factory';
import { z } from 'zod';
import { getAllRecipes } from '../tools';

// Tool-as-step: Use getAllRecipes tool directly as a workflow step
const getRecipesForMealPlanning = createToolStep({
    id: 'get-recipes-for-meal-planning',
    description: 'Fetches all recipes and filters for dinner recipes suitable for meal planning',
    tool: getAllRecipes,
    inputSchema: z.any(),
    inputTransform: (input) => input, // getAllRecipes doesn't need specific input transformation
});

// Agent-as-step: Use meal plan selector agent to select and generate complete meal plan
const generateCompleteMealPlan = createAgentStep({
    id: 'generate-complete-meal-plan',
    description: 'Uses meal plan agents to select recipes and generate complete meal plan',
    agentName: 'mealPlanGenerator',
    inputSchema: getAllRecipes.outputSchema,
    outputSchema: z.object({
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
    }),
    prompt: ({ context }) => `Create a detailed weekly meal plan by first selecting 2 optimal recipes from the following options, then generating a complete meal plan with proper scheduling and scaled ingredients:

${JSON.stringify(context, null, 2)}

Focus on dinner/evening meals (look for "aftensmad" or similar categories). Generate the complete meal plan with proper scheduling.`,
    structuredOutput: {
        schema: z.object({
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
        })
    }
});

// Agent-as-step: Use email formatter agent to generate HTML email
const generateMealPlanEmail = createAgentStep({
    id: 'generate-meal-plan-email',
    description: 'Generates HTML email using the specialized email formatter agent',
    agentName: 'mealPlanEmailFormatter',
    inputSchema: z.object({
        mealplan: z.array(z.object({
            days: z.array(z.string()),
            recipe: z.object({
                title: z.string(),
                ingredients: z.array(z.string()),
                directions: z.array(z.string()),
                imageUrl: z.string(),
                url: z.string(),
            }).nullable(),
        })),
    }),
    outputSchema: z.object({
        htmlContent: z.string(),
        subject: z.string(),
    }),
    prompt: ({ context }) => `Format this meal plan into a professional HTML email:

${JSON.stringify(context, null, 2)}

Return only the HTML content without any additional text or markdown.`,
    // For email generation, we'll handle the response transformation differently
});

// Main weekly meal planning workflow using tool-as-step and agent-as-step patterns
export const weeklyMealPlanningWorkflow = createWorkflow({
    id: 'weekly-meal-planning-workflow',
    inputSchema: z.any(),
    outputSchema: z.object({
        htmlContent: z.string(),
        subject: z.string(),
    }),
})
    .then(getRecipesForMealPlanning)
    .then(generateCompleteMealPlan)
    .then(generateMealPlanEmail)
    .commit();