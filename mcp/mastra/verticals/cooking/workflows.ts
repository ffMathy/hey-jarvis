import { z } from 'zod';
import { createAgentStep, createStep, createToolStep, createWorkflow, getModel } from '../../utils/index.js';
import { getSendEmailAndAwaitResponseWorkflow } from '../human-in-the-loop/workflows.js';
import { shoppingListWorkflow } from '../shopping/workflows.js';
import { getAllRecipes } from './tools.js';

// Use Gemini Flash for cooking workflows - better quality for recipe processing
const cookingModel = getModel('gemini-flash-latest');

// Response schema for meal plan feedback - captures the human's free-form response
const mealPlanFeedbackResponseSchema = z.object({
  feedbackText: z.string().describe('The human feedback text about the meal plan'),
  isApprovalIntent: z.boolean().optional().describe('Initial assessment if this seems like an approval'),
});

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
// Uses Gemini Flash for cooking workflow - better quality for recipe processing
const generateMealPlanStateSchema = z
  .object({
    preferences: z.string(), // Used by generate-complete-meal-plan step
  })
  .partial();

export const generateMealPlanWorkflow = createWorkflow({
  id: 'generateMealPlanWorkflow',
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
    }),
  )
  .then(
    createToolStep({
      id: 'get-all-recipes',
      description: 'Fetches all recipes for meal planning',
      tool: getAllRecipes,
      inputOverrides: {
        amount: process.env.IS_DEVCONTAINER ? 10 : undefined,
      },
    }),
  )
  .then(
    createAgentStep({
      id: 'generate-complete-meal-plan',
      description: 'Uses meal plan agents to select recipes and generate complete meal plan',
      agentConfig: {
        model: cookingModel,
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
      stateSchema: generateMealPlanStateSchema,
      inputSchema: getAllRecipes.outputSchema!,
      outputSchema: z.object({
        mealplan: mealPlanSchema,
      }),
      prompt: ({ inputData, state }) => {
        const preferencesText = state?.preferences ? `\n\nUser preferences: ${state.preferences}` : '';

        return `Create a detailed weekly meal plan by first selecting 2 optimal recipes from the following options, then generating a complete meal plan with proper scheduling and scaled ingredients:

${JSON.stringify(inputData, null, 2)}

Focus on dinner/evening meals (look for "aftensmad" or similar categories). Generate the complete meal plan with proper scheduling.${preferencesText}`;
      },
    }),
  )
  .commit();

// Uses Gemini Flash for cooking workflow - better quality for recipe processing
const generateMealPlanEmail = createAgentStep({
  id: 'generate-meal-plan-email',
  description: 'Generates HTML email using the specialized email formatter agent',
  agentConfig: {
    model: cookingModel,
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
- Write everything in Danish

IMPORTANT: The subject line must be plain text only - no HTML tags or formatting allowed. Only the body (htmlContent) should contain HTML.`,
    description: 'Specialized agent for formatting meal plans into HTML emails',
    tools: undefined,
  },
  inputSchema: z.object({
    mealplan: mealPlanSchema,
  }),
  outputSchema: z.object({
    htmlContent: z.string(),
    subject: z.string().describe('Plain text email subject line - no HTML allowed'),
    mealplan: mealPlanSchema,
  }),
  prompt: ({ inputData }) => {
    return `Format this meal plan into a professional HTML email:

${JSON.stringify(inputData.mealplan, null, 2)}

Return the HTML content for the email body, and a plain text subject line. Do not include any markdown or additional text.`;
  },
});

// State schema for the weekly meal planning workflow with human-in-the-loop
const weeklyMealPlanningStateSchema = z
  .object({
    mealplan: mealPlanSchema, // Current meal plan being reviewed
    isApproved: z.boolean(), // Whether the meal plan has been approved
    feedbackHistory: z.array(z.string()), // History of feedback for context
  })
  .partial();

// Step: Prepare email question for human feedback
const prepareMealPlanFeedbackQuestion = createStep({
  id: 'prepare-meal-plan-feedback-question',
  description: 'Prepares the question for requesting meal plan feedback',
  inputSchema: z.object({
    htmlContent: z.string(),
    subject: z.string(),
    mealplan: mealPlanSchema,
  }),
  stateSchema: weeklyMealPlanningStateSchema,
  outputSchema: z.object({
    recipientEmail: z.string(),
    question: z.string(),
  }),
  execute: async ({ inputData, setState, state }) => {
    const recipientEmails = process.env.HEY_JARVIS_MEAL_PLAN_NOTIFICATION_EMAIL;
    if (!recipientEmails) {
      throw new Error(
        'HEY_JARVIS_MEAL_PLAN_NOTIFICATION_EMAIL environment variable is not set. ' +
          'Please configure meal_plan_notification_email in the Home Assistant addon settings.',
      );
    }

    // Get the first email for the feedback request
    const recipientEmail = recipientEmails.split(',')[0].trim();

    // Store the current meal plan in state for later steps to access
    setState({
      ...(state as Record<string, unknown>),
      mealplan: inputData.mealplan,
      isApproved: false,
    });

    // Create a question that includes the meal plan HTML
    const question = `
Ugentlig madplan til gennemgang:

${inputData.htmlContent}

---

Svar venligst med:
- "Godkendt" eller "OK" for at godkende madplanen og tilføje ingredienser til indkøbslisten
- Eller beskriv de ændringer du ønsker (f.eks. "Byt ret X ud med noget med kylling")
    `.trim();

    return {
      recipientEmail,
      question,
    };
  },
});

// Step: Extract feedback response and determine if approved or changes needed
const extractMealPlanFeedbackResponse = createAgentStep({
  id: 'extract-meal-plan-feedback-response',
  description: 'Analyzes the human feedback to determine if approved or changes requested',
  stateSchema: weeklyMealPlanningStateSchema,
  agentConfig: {
    model: cookingModel,
    id: 'feedbackAnalyzer',
    name: 'FeedbackAnalyzer',
    instructions: `You are an expert at analyzing human feedback for meal plans.

Your job is to:
1. Determine if the user has approved the meal plan
2. Extract any requested changes or modifications
3. Identify specific preferences mentioned

Approval indicators (Danish and English):
- "Godkendt", "OK", "Ser godt ud", "Fint", "Approved", "Looks good", "Perfect"

Change request indicators:
- Mentions of specific dishes to replace
- Requests for different ingredients
- Dietary concerns or preferences
- Any feedback that isn't pure approval`,
    description: 'Specialized agent for analyzing meal plan feedback',
    tools: undefined,
  },
  inputSchema: z.object({
    senderEmail: z.string(),
    response: mealPlanFeedbackResponseSchema,
  }),
  outputSchema: z.object({
    isApproved: z.boolean(),
    feedbackText: z.string(),
    requestedChanges: z.string().optional(),
    mealplan: mealPlanSchema,
  }),
  prompt: ({ inputData, state }) => {
    const feedbackHistory = state?.feedbackHistory || [];
    const mealplan = state?.mealplan || [];
    const historyContext = feedbackHistory.length > 0 ? `\n\nPrevious feedback:\n${feedbackHistory.join('\n')}` : '';

    return `Analyze this meal plan feedback response:

Feedback text: ${inputData.response.feedbackText}
Initial approval assessment: ${inputData.response.isApprovalIntent ?? 'unknown'}

Current meal plan: ${JSON.stringify(mealplan, null, 2)}
${historyContext}

Determine:
1. Is the meal plan approved? (isApproved: true/false)
2. What is the feedback text? (feedbackText: the user's response)
3. If changes are requested, what are they? (requestedChanges: description of changes or undefined if approved)

Return the structured analysis. Also return the current mealplan unmodified.`;
  },
});

// Step: Update state with feedback and prepare for potential regeneration
const processMealPlanFeedback = createStep({
  id: 'process-meal-plan-feedback',
  description: 'Updates workflow state based on feedback analysis',
  stateSchema: weeklyMealPlanningStateSchema,
  inputSchema: z.object({
    isApproved: z.boolean(),
    feedbackText: z.string(),
    requestedChanges: z.string().optional(),
    mealplan: mealPlanSchema,
  }),
  outputSchema: z.object({
    isApproved: z.boolean(),
    preferences: z.string().optional(),
    mealplan: mealPlanSchema,
  }),
  execute: async ({ inputData, setState, state }) => {
    const feedbackHistory = state?.feedbackHistory || [];

    // Update state with feedback
    setState({
      ...state,
      isApproved: inputData.isApproved,
      feedbackHistory: [...feedbackHistory, inputData.feedbackText],
    });

    return {
      isApproved: inputData.isApproved,
      // If changes requested, pass them as preferences for regeneration
      preferences: inputData.requestedChanges,
      mealplan: inputData.mealplan,
    };
  },
});

// Step: Prepare for regeneration with new preferences
const prepareForRegeneration = createStep({
  id: 'prepare-for-regeneration',
  description: 'Prepares input for meal plan regeneration with updated preferences',
  stateSchema: weeklyMealPlanningStateSchema,
  inputSchema: z.object({
    isApproved: z.boolean(),
    preferences: z.string().optional(),
    mealplan: mealPlanSchema,
  }),
  outputSchema: z.object({
    preferences: z.string().optional(),
    isApproved: z.boolean(),
  }),
  execute: async ({ inputData, state }) => {
    // Combine new preferences with recent feedback history (limit to last 3 to avoid token limits)
    const feedbackHistory = state?.feedbackHistory || [];
    const recentFeedback = feedbackHistory.slice(-3);
    const combinedPreferences = inputData.preferences
      ? `${inputData.preferences}\n\nRecent feedback: ${recentFeedback.join('; ')}`
      : undefined;

    return {
      preferences: combinedPreferences,
      isApproved: inputData.isApproved,
    };
  },
});

// Step: Extract ingredients and prepare shopping list prompt
const prepareShoppingListPrompt = createStep({
  id: 'prepare-shopping-list-prompt',
  description: 'Extracts all ingredients from approved meal plan for shopping list',
  stateSchema: weeklyMealPlanningStateSchema,
  inputSchema: z.object({
    isApproved: z.boolean(),
    preferences: z.string().optional(),
  }),
  outputSchema: z.object({
    prompt: z.string(),
  }),
  execute: async ({ state }) => {
    // Get the meal plan from state (stored during prepare-meal-plan-feedback-question step)
    const mealplan = state?.mealplan || [];

    // Extract all ingredients from all recipes
    const allIngredients: string[] = [];
    for (const day of mealplan) {
      if (day.recipe?.ingredients) {
        allIngredients.push(...day.recipe.ingredients);
      }
    }

    // Create a prompt for the shopping list workflow
    const prompt = `Tilføj følgende ingredienser til indkøbslisten (fra denne uges madplan):

${allIngredients.join('\n')}`;

    return { prompt };
  },
});

// Step: Format final output after shopping list is updated
const formatFinalOutput = createStep({
  id: 'format-final-output',
  description: 'Formats the final workflow output',
  inputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    itemsProcessed: z.number().optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ inputData }) => {
    const shoppingMessage = inputData.message || 'Shopping list updated.';
    return {
      success: inputData.success,
      message: `Madplan godkendt og ingredienser tilføjet til indkøbslisten. ${shoppingMessage}`,
    };
  },
});

// Sub-workflow for the feedback loop iteration
// This generates meal plan, formats email, requests feedback
const mealPlanFeedbackIterationWorkflow = createWorkflow({
  id: 'mealPlanFeedbackIterationWorkflow',
  inputSchema: z.object({
    preferences: z.string().optional(),
    isApproved: z.boolean().optional(),
  }),
  outputSchema: z.object({
    isApproved: z.boolean(),
    preferences: z.string().optional(),
  }),
})
  // Map input to generateMealPlanWorkflow input schema
  .map(async ({ inputData }) => ({
    preferences: inputData.preferences,
  }))
  .then(generateMealPlanWorkflow) // Generate meal plan (with preferences if any)
  .then(generateMealPlanEmail) // Format as HTML email
  .then(prepareMealPlanFeedbackQuestion) // Prepare feedback question
  // Map to sendEmailAndAwaitResponseWorkflow input schema
  .map(async ({ inputData }) => ({
    recipientEmail: inputData.recipientEmail,
    question: inputData.question,
  }))
  .then(getSendEmailAndAwaitResponseWorkflow('mealPlanFeedback', mealPlanFeedbackResponseSchema)) // Send email and wait for human response
  .then(extractMealPlanFeedbackResponse) // Analyze the response
  .then(processMealPlanFeedback) // Update state and prepare output
  .then(prepareForRegeneration) // Prepare for potential next iteration
  .commit();

// Main weekly meal planning workflow with human-in-the-loop feedback
// Uses dowhile to keep iterating until the meal plan is approved
// When approved, adds ingredients to shopping list
export const weeklyMealPlanningWorkflow = createWorkflow({
  id: 'weeklyMealPlanningWorkflow',
  inputSchema: z.object({}).partial(),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
})
  // Initialize with no preferences and not approved
  .then(
    createStep({
      id: 'initialize-workflow',
      description: 'Initializes the workflow with default values',
      inputSchema: z.object({}).partial(),
      outputSchema: z.object({
        preferences: z.string().optional(),
        isApproved: z.boolean(),
      }),
      execute: async ({ setState }) => {
        setState({
          isApproved: false,
          feedbackHistory: [],
        });
        return {
          preferences: undefined,
          isApproved: false,
        };
      },
    }),
  )
  // Keep iterating until approved
  // @ts-expect-error - Mastra v1 beta.10 dowhile has state schema compatibility issues that prevent proper type inference
  .dowhile(mealPlanFeedbackIterationWorkflow, async ({ inputData }) => !inputData.isApproved)
  // Once approved, add ingredients to shopping list
  .then(prepareShoppingListPrompt)
  // Map to shoppingListWorkflow input schema
  .map(async ({ inputData }) => ({
    prompt: inputData.prompt,
  }))
  .then(shoppingListWorkflow)
  .then(formatFinalOutput)
  .commit();
