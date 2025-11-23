import { z } from 'zod';
import { createAgentStep, createStep, createToolStep, createWorkflow } from '../../../utils/workflow-factory.js';
import { sendEmail } from '../../email/tools.js';
import { getAllRecipes } from '../tools.js';

const mealPlanSchema = z.array(
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
);

// Step 1: Get all recipes using createToolStep
const getRecipesForMealPlanning = createToolStep({
  id: 'get-recipes-for-meal-planning',
  description: 'Fetches all recipes and filters for dinner recipes suitable for meal planning',
  tool: getAllRecipes,
});

// Step 1b: Wrap recipes array in object for next step
const wrapRecipesInObject = createStep({
  id: 'wrap-recipes-in-object',
  description: 'Wraps the recipes array in an object structure for the next step',
  inputSchema: getAllRecipes.outputSchema,
  outputSchema: z.object({
    recipes: getAllRecipes.outputSchema,
  }),
  execute: async ({ inputData }) => {
    return { recipes: inputData };
  },
});

// Step 2: Generate complete meal plan
// Recipes passed through context - no state needed since only used once
const generateCompleteMealPlan = createAgentStep({
  id: 'generate-complete-meal-plan',
  description: 'Uses meal plan agents to select recipes and generate complete meal plan',
  agentName: 'mealPlanGenerator',
  inputSchema: wrapRecipesInObject.outputSchema,
  outputSchema: z.object({
    mealplan: mealPlanSchema,
  }),
  prompt: ({ context }) => {
    return `Create a detailed weekly meal plan by first selecting 2 optimal recipes from the following options, then generating a complete meal plan with proper scheduling and scaled ingredients:

${JSON.stringify(context.recipes, null, 2)}

Focus on dinner/evening meals (look for "aftensmad" or similar categories). Generate the complete meal plan with proper scheduling.`;
  },
});

// Step 3: Generate HTML email
// Meal plan passed through context - no state needed since only used once
const generateMealPlanEmail = createAgentStep({
  id: 'generate-meal-plan-email',
  description: 'Generates HTML email using the specialized email formatter agent',
  agentName: 'mealPlanEmailFormatter',
  inputSchema: generateCompleteMealPlan.outputSchema,
  outputSchema: z.object({
    htmlContent: z.string(),
    subject: z.string(),
  }),
  prompt: ({ context }) => {
    return `Format this meal plan into a professional HTML email:

${JSON.stringify(context.mealplan, null, 2)}

Return only the HTML content without any additional text or markdown.`;
  },
});

// Step 4: Send email
// Email content passed through context - no state needed
const sendMealPlanEmail = createStep({
  id: 'send-meal-plan-email',
  description: 'Sends the meal plan email to configured recipients',
  inputSchema: generateMealPlanEmail.outputSchema,
  outputSchema: z.object({
    messageId: z.string(),
    subject: z.string(),
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ inputData }) => {
    const recipientEmails = process.env.HEY_JARVIS_MEAL_PLAN_NOTIFICATION_EMAIL;
    if (!recipientEmails) {
      throw new Error(
        'HEY_JARVIS_MEAL_PLAN_NOTIFICATION_EMAIL environment variable is not set. ' +
          'Please configure meal_plan_notification_email in the Home Assistant addon settings.',
      );
    }

    // Split comma-separated emails and trim whitespace
    const toRecipients = recipientEmails
      .split(',')
      .map((email) => email.trim())
      .filter((email) => email.length > 0);

    if (toRecipients.length === 0) {
      throw new Error('No valid email recipients found in HEY_JARVIS_MEAL_PLAN_NOTIFICATION_EMAIL');
    }

    // Call the sendEmail tool
    return await sendEmail.execute({
      subject: inputData.subject,
      bodyContent: inputData.htmlContent,
      toRecipients,
    });
  },
});

// Main weekly meal planning workflow
// No state needed - data flows directly through context from step to step
export const weeklyMealPlanningWorkflow = createWorkflow({
  id: 'weeklyMealPlanningWorkflow',
  inputSchema: getRecipesForMealPlanning.inputSchema,
  outputSchema: z.object({
    htmlContent: z.string(),
    subject: z.string(),
  }),
})
  .then(getRecipesForMealPlanning)
  .then(wrapRecipesInObject)
  .then(generateCompleteMealPlan)
  .then(generateMealPlanEmail)
  .then(sendMealPlanEmail)
  .commit();
