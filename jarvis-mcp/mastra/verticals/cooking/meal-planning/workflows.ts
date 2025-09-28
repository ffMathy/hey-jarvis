import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { getAllRecipes } from '../tools';

// Step to get recipe data for meal planning using the getAllRecipes tool directly
const getRecipesForMealPlanning = createStep({
    id: 'get-recipes-for-meal-planning',
    description: 'Fetches all recipes and filters for dinner recipes suitable for meal planning',
    inputSchema: z.any(),
    outputSchema: getAllRecipes.outputSchema.describe('Array of dinner recipes suitable for meal planning'),
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

        return dinnerRecipes;
    },
});

// Step 1: Select optimal recipes using the meal plan selector agent
const selectRecipesForMealPlan = createStep({
    id: 'select-recipes-for-meal-plan',
    description: 'Uses meal plan selector agent to select optimal recipes for weekly meal planning',
    inputSchema: getRecipesForMealPlanning.outputSchema,
    outputSchema: z.object({
        selectedRecipes: getAllRecipes.outputSchema,
    }),
    execute: async ({ inputData, mastra }) => {
        const selectorAgent = mastra?.getAgent('mealPlanSelector');
        if (!selectorAgent) {
            throw new Error('Meal plan selector agent not found');
        }

        let prompt = `Select 2 optimal recipes for a weekly meal plan from the following options:

${JSON.stringify(inputData, null, 2)}`;

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

        const selectedRecipes = inputData.filter(recipe =>
            selectionResult.selectedRecipeIds.includes(recipe.id)
        );

        return {
            selectedRecipes
        };
    },
});

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

// Schema for human approval response
const approvalResponseSchema = z.object({
    approved: z.boolean().describe('Whether the meal plan is approved'),
    improvements: z.string().optional().describe('Suggested improvements if not approved'),
});

// Step 2: Generate detailed meal plan using the meal plan generator agent
const generateDetailedMealPlan = createStep({
    id: 'generate-detailed-meal-plan',
    description: 'Uses meal plan generator agent to create detailed weekly meal plan from selected recipes',
    inputSchema: selectRecipesForMealPlan.outputSchema,
    outputSchema: mealPlanSchema,
    execute: async ({ inputData, mastra }) => {
        const generatorAgent = mastra?.getAgent('mealPlanGenerator');
        if (!generatorAgent) {
            throw new Error('Meal plan generator agent not found');
        }

        const planResponse = await generatorAgent.streamVNext([
            {
                role: 'user',
                content: `Create a detailed weekly meal plan using these selected recipes:\n\n${JSON.stringify(inputData.selectedRecipes, null, 2)}\n\nGenerate the complete meal plan with proper scheduling and scaled ingredients.`,
            },
        ], {
            structuredOutput: {
                schema: mealPlanSchema
            }
        });

        // Get the structured result directly from the response
        const mealPlan = await planResponse.object;
        return mealPlan;
    },
});

// Step to suspend for human approval of the meal plan
const requestHumanApproval = createStep({
    id: 'request-human-approval',
    description: 'Suspends workflow to request human approval of the generated meal plan',
    inputSchema: mealPlanSchema,
    outputSchema: z.object({
        mealPlan: mealPlanSchema,
        approved: z.boolean(),
        improvements: z.string().optional(),
    }),
    execute: async ({ inputData, suspend }) => {
        // Present the meal plan for human review
        const presentationData = {
            message: 'Please review the following meal plan and decide whether to approve it',
            mealPlan: inputData,
        };

        // Suspend execution and wait for human input
        const humanResponse = await suspend({
            id: 'meal-plan-approval',
            data: presentationData,
            schema: approvalResponseSchema,
        });

        return {
            mealPlan: inputData,
            approved: humanResponse.approved,
            improvements: humanResponse.improvements,
        };
    },
});

// Step to handle approval logic and either proceed or loop back
const handleApprovalLogic = createStep({
    id: 'handle-approval-logic',
    description: 'Handles the approval logic - either adds to shopping list or returns rejection info',
    inputSchema: z.object({
        mealPlan: mealPlanSchema,
        approved: z.boolean(),
        improvements: z.string().optional(),
    }),
    outputSchema: z.object({
        success: z.boolean(),
        message: z.string(),
        mealPlan: mealPlanSchema,
        shoppingListResult: z.object({
            success: z.boolean(),
            message: z.string(),
        }).optional(),
    }),
    execute: async ({ inputData, mastra }) => {
        if (inputData.approved) {
            // If approved, add ingredients to shopping list
            const allIngredients = inputData.mealPlan.mealplan
                .filter(meal => meal.recipe)
                .flatMap(meal => meal.recipe!.ingredients);

            const shoppingPrompt = `Add the following ingredients to the shopping list:\n${allIngredients.join('\n')}`;

            try {
                // Execute the shopping list workflow
                const shoppingResult = await mastra?.runWorkflow('shopping-list-workflow', {
                    prompt: shoppingPrompt,
                });

                return {
                    success: true,
                    message: 'Meal plan approved and ingredients added to shopping list',
                    mealPlan: inputData.mealPlan,
                    shoppingListResult: {
                        success: true,
                        message: `Successfully added ${allIngredients.length} ingredients to shopping list: ${shoppingResult?.message || 'Added items'}`,
                    },
                };
            } catch (error) {
                return {
                    success: true,
                    message: 'Meal plan approved but failed to add ingredients to shopping list',
                    mealPlan: inputData.mealPlan,
                    shoppingListResult: {
                        success: false,
                        message: `Failed to add ingredients to shopping list: ${error}`,
                    },
                };
            }
        } else {
            // If not approved, return the meal plan with rejection info
            return {
                success: false,
                message: `Meal plan was not approved. Improvements requested: ${inputData.improvements || 'No specific improvements provided'}`,
                mealPlan: inputData.mealPlan,
            };
        }
    },
});

// Main weekly meal planning workflow with human-in-the-loop approval
export const weeklyMealPlanningWorkflow = createWorkflow({
    id: 'weekly-meal-planning-workflow',
    inputSchema: z.any(),
    outputSchema: z.object({
        success: z.boolean(),
        message: z.string(),
        mealPlan: mealPlanSchema,
        shoppingListResult: z.object({
            success: z.boolean(),
            message: z.string(),
        }).optional(),
    }),
})
    .then(getRecipesForMealPlanning)
    .then(selectRecipesForMealPlan)
    .then(generateDetailedMealPlan)
    .then(requestHumanApproval)
    .then(handleApprovalLogic)
    .commit();

// Workflow to regenerate meal plan with improvements (can be called separately)
export const regenerateMealPlanWorkflow = createWorkflow({
    id: 'regenerate-meal-plan-workflow',
    inputSchema: z.object({
        improvements: z.string().describe('Specific improvements to incorporate into the new meal plan'),
    }),
    outputSchema: z.object({
        success: z.boolean(),
        message: z.string(),
        mealPlan: mealPlanSchema,
        shoppingListResult: z.object({
            success: z.boolean(),
            message: z.string(),
        }).optional(),
    }),
})
    .then(getRecipesForMealPlanning)
    .then(selectRecipesForMealPlan)
    .then(createStep({
        id: 'generate-improved-meal-plan',
        description: 'Generates an improved meal plan based on feedback',
        inputSchema: z.object({
            selectedRecipes: getAllRecipes.outputSchema,
        }),
        outputSchema: mealPlanSchema,
        execute: async ({ inputData, mastra, context }) => {
            const generatorAgent = mastra?.getAgent('mealPlanGenerator');
            if (!generatorAgent) {
                throw new Error('Meal plan generator agent not found');
            }

            // Get improvements from the workflow input
            const improvements = (context as any).improvements || 'Create an improved meal plan';

            const planResponse = await generatorAgent.streamVNext([
                {
                    role: 'user',
                    content: `Create an improved weekly meal plan using these selected recipes:\n\n${JSON.stringify(inputData.selectedRecipes, null, 2)}\n\nIncorporate these improvements: ${improvements}\n\nGenerate the complete meal plan with proper scheduling and scaled ingredients.`,
                },
            ], {
                structuredOutput: {
                    schema: mealPlanSchema
                }
            });

            // Get the structured result directly from the response
            const mealPlan = await planResponse.object;
            return mealPlan;
        },
    }))
    .then(requestHumanApproval)
    .then(handleApprovalLogic)
    .commit();