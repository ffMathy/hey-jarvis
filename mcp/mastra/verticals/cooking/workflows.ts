import { z } from 'zod';
import { createAgentStep, createStep, createToolStep, createWorkflow } from '../../utils/workflow-factory.js';
import { sendEmail } from '../email/tools.js';
import { getAllRecipes } from './tools.js';

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

// Meal plan generation workflow (without email sending)
// Can be used by agents or other workflows to generate meal plans
const generateMealPlanStateSchema = z
  .object({
    preferences: z.string(), // Used by generate-complete-meal-plan step
  })
  .partial();

export const generateMealPlanWorkflow = createWorkflow({
  id: 'generateMealPlanWorkflow',
  stateSchema: generateMealPlanStateSchema,
  inputSchema: z.object({
    preferences: z.string().optional().describe('Optional preferences for the meal plan'),
  }),
  outputSchema: z.object({
    mealplan: mealPlanSchema,
  }),
})
  .then(
    createStep({
      id: 'store-preferences',
      description: 'Store preferences in workflow state for later use',
      stateSchema: generateMealPlanStateSchema,
      inputSchema: z.object({
        preferences: z.string().optional(),
      }),
      outputSchema: z.object({}),
      execute: async (params) => {
        if (params.inputData.preferences) {
          params.setState({
            preferences: params.inputData.preferences,
          });
        }
        return {};
      },
    })
  )
  .then(
    createToolStep({
      id: 'get-all-recipes',
      description: 'Fetches all recipes for meal planning',
      stateSchema: generateMealPlanStateSchema,
      tool: getAllRecipes,
    })
  )
  .then(
    createAgentStep({
      id: 'generate-complete-meal-plan',
      description: 'Uses meal plan agents to select recipes and generate complete meal plan',
      stateSchema: generateMealPlanStateSchema,
      agentConfig: {
        id: 'mealPlanGenerator',
        name: 'MealPlanGenerator',
        instructions: `You are a meal scheduling specialist.
      
      Your ONLY job is to take selected recipes and create a weekly schedule.
      
      Scheduling rules:
      1. Scale ingredients for 6 people (2 people × 3 days per recipe)
      2. Order recipes by ingredient expiry speed:
         - Meat and dairy first
         - Fresh herbs and vegetables next
         - Pantry staples last
      3. Assign Danish weekday names
      4. Ensure proper ingredient quantities
      
      Do NOT:
      - Search for new recipes
      - Select different recipes
      - Format for email presentation`,
        description: 'Specialized agent for creating weekly meal plan schedules',
        tools: undefined,
      },
      inputSchema: getAllRecipes.outputSchema,
      outputSchema: z.object({
        mealplan: mealPlanSchema,
      }),
      prompt: ({ context, workflow }) => {
        const preferencesText = workflow?.state?.preferences
          ? `\n\nUser preferences: ${workflow.state.preferences}`
          : '';

        return `Create a detailed weekly meal plan by first selecting 2 optimal recipes from the following options, then generating a complete meal plan with proper scheduling and scaled ingredients:

${JSON.stringify(context, null, 2)}

Focus on dinner/evening meals (look for "aftensmad" or similar categories). Generate the complete meal plan with proper scheduling.${preferencesText}`;
      },
    })
  )
  .commit();

// Step 4: Send email
// Email content passed through context - no state needed
const sendMealPlanEmail = createStep({
  id: 'send-meal-plan-email',
  description: 'Sends the meal plan email to configured recipients',
  inputSchema: z.object({
    htmlContent: z.string(),
    subject: z.string(),
    mealplan: mealPlanSchema,
  }),
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

const generateMealPlanEmail = createAgentStep({
  id: 'generate-meal-plan-email',
  description: 'Generates HTML email using the specialized email formatter agent',
  stateSchema: generateMealPlanStateSchema,
  agentConfig: {
    id: 'emailFormatter',
    name: 'EmailFormatter',
    instructions: `You are an HTML email formatting specialist for meal plans.

Your ONLY job is to convert meal plan data into properly formatted HTML emails.

Format requirements (for every recipe in the plan):
1. Recipe title: Large font, center-aligned, linked to recipe URL
2. Days: Center-aligned below title
3. Recipe image: Center-aligned, linked to recipe URL
4. Meat/dairy prep ingredients: White font, left-aligned, larger font title
5. Vegetable/fruit prep ingredients: Clear color, left-aligned, larger font title
6. Other ingredients: Clear color, left-aligned, with purpose notes "(for sauce)"
7. Directions: Bullet format, clear color, left-aligned, larger font title

Special features:
- Add "save X g for later" notes (50% transparent, smaller font) for ingredients used in multiple recipes
- Use colors compatible with light/dark email themes
- Include proper spacing between sections
- Make HTML email-client compatible with inline styles
- Write everything in Danish`,
    description: 'Specialized agent for formatting meal plans into HTML emails',
    tools: undefined,
  },
  inputSchema: z.object({
    mealplan: mealPlanSchema,
  }),
  outputSchema: z.object({
    htmlContent: z.string(),
    subject: z.string(),
    mealplan: mealPlanSchema,
  }),
  prompt: ({ context }) => {
    return `Format this meal plan into a professional HTML email:

${JSON.stringify(context.mealplan, null, 2)}

Return only the HTML content without any additional text or markdown.`;
  },
});
// Main weekly meal planning workflow
// Uses generateMealPlanWorkflow then sends email
export const weeklyMealPlanningWorkflow = createWorkflow({
  id: 'weeklyMealPlanningWorkflow',
  inputSchema: z.object({}).partial(),
  outputSchema: z.object({
    messageId: z.string(),
    subject: z.string(),
    success: z.boolean(),
    message: z.string(),
  }),
})
  .then(generateMealPlanWorkflow)
  .then(generateMealPlanEmail)
  .then(sendMealPlanEmail)
  .commit();
