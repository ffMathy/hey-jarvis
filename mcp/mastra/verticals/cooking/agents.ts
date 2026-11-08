import type { Agent } from '@mastra/core/agent';
import type { Knowledge } from '@mastra/core/knowledge';
import { conventionsNoteInstructions, readConventions } from '../../knowledge/conventions.js';
import { getJarvisKnowledge, householdKnowledgeOptions } from '../../knowledge/index.js';
import { createAgent, LOW_THINKING_PROVIDER_OPTIONS } from '../../utils/index.js';
import { currentBabyMealGuidance } from './baby-food.js';
import { cookingConventions, dinnerConventionsSection } from './conventions.js';
import { cookingTools } from './tools.js';
import { generateMealPlanWorkflow } from './workflows.js';

/**
 * What the cooking agent is told: `conventions` are the household's dinner conventions as
 * {@link readConventions} reads them, and it is told how to add one sir states. With a baby in the
 * household, it also keeps to the advice for the baby's age (`./baby-food.ts`) whenever it suggests
 * or describes a dinner.
 */
export function cookingAgentInstructions(babyGuidance: string | undefined, conventions: string): string {
  const babyRules = babyGuidance
    ? `
- When you suggest, choose or describe a dinner, prefer one the baby can share, following its advice below, and say briefly how to prepare the baby's portion where it differs from the adults'`
    : '';

  const instructions = `You are a comprehensive cooking and meal planning assistant specializing in Danish recipes from Valdemarsro.

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
- Keep to the household's dinner conventions below
- For meal planning requests, delegate to the generateMealPlanWorkflow workflow${babyRules}

Acting quickly:
- Every tool call is a round trip the user waits through, so use as few as the request allows.
- searchRecipes returns the recipes in full, ingredients and directions included. Answer from its results; only call getRecipeById for a recipe you know by id and do not already have.
- When you need several searches, make them together in the same step rather than one after another.
- To browse the whole catalogue, use getRecipeCatalog, never getAllRecipes, which returns every recipe in full.

${dinnerConventionsSection(conventions)}

${conventionsNoteInstructions(cookingConventions, "the household's dinners")}`;

  return babyGuidance ? `${instructions}\n\n${babyGuidance}` : instructions;
}

/**
 * The cooking agent, with access to the meal planning workflow and recipe search.
 *
 * It reads the household's dinner conventions from `getKnowledge`'s Knowledge, and holds the
 * household there, which brings the Knowledge tools it adds a convention sir states with. The
 * household's runs are given Jarvis's own; a spec hands in one of its own.
 */
export async function getCookingAgent(getKnowledge: () => Promise<Knowledge> = getJarvisKnowledge): Promise<Agent> {
  const knowledge = await getKnowledge();

  return createAgent({
    id: 'cooking',
    name: 'Cooking',
    // Resolved on every request: the server stays up for days, the baby keeps growing, and a
    // convention sir stated in one conversation is to be followed in the next.
    instructions: async () =>
      cookingAgentInstructions(currentBabyMealGuidance(), await readConventions(knowledge, cookingConventions)),
    description:
      "Comprehensive cooking agent for recipe search and meal planning, including what the household's baby can be given from the family's dinners",
    tools: cookingTools,
    workflows: {
      generateMealPlanWorkflow,
    },
    ...householdKnowledgeOptions(knowledge),
    // Choosing a search term and reading the results back needs little reasoning, and every step
    // of the tool loop pays for whatever thinking the model does. The meal plan keeps its default
    // thinking inside the workflow, where the scaling and scheduling happen.
    defaultOptions: { providerOptions: LOW_THINKING_PROVIDER_OPTIONS },
  });
}
