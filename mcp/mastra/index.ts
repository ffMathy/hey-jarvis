import { Mastra } from '@mastra/core';
import { PinoLogger } from '@mastra/loggers';
import { Observability } from '@mastra/observability';
import { getSqlStorageProvider } from './storage/index.js';
import {
  getCodingAgent,
  getMealPlanEmailFormatterAgent,
  getMealPlanGeneratorAgent,
  getMealPlanSelectorAgent,
  getNotificationAgent,
  getRecipeSearchAgent,
  getRequirementsInterviewerAgent,
  getShoppingListAgent,
  getShoppingListSummaryAgent,
  getWeatherAgent,
  implementFeatureWorkflow,
  weatherMonitoringWorkflow,
  weeklyMealPlanningWorkflow
} from './verticals/index.js';

async function createMastra() {
  process.env['GOOGLE_GENERATIVE_AI_API_KEY'] = process.env['HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY'] || '';

  const sqlStorageProvider = await getSqlStorageProvider();

  // Get all agents
  const [
    weatherAgent,
    recipeSearchAgent,
    mealPlanSelectorAgent,
    mealPlanGeneratorAgent,
    mealPlanEmailFormatterAgent,
    shoppingListAgent,
    shoppingListSummaryAgent,
    notificationAgent,
    codingAgent,
    requirementsInterviewerAgent,
  ] = await Promise.all([
    getWeatherAgent(),
    getRecipeSearchAgent(),
    getMealPlanSelectorAgent(),
    getMealPlanGeneratorAgent(),
    getMealPlanEmailFormatterAgent(),
    getShoppingListAgent(),
    getShoppingListSummaryAgent(),
    getNotificationAgent(),
    getCodingAgent(),
    getRequirementsInterviewerAgent(),
  ]);

  return new Mastra({
    storage: sqlStorageProvider,
    logger: new PinoLogger({
      name: 'Mastra',
      level: 'info',
    }),
    observability: new Observability({ default: { enabled: true } }),
    workflows: {
      weatherMonitoringWorkflow,
      weeklyMealPlanningWorkflow,
      implementFeatureWorkflow,
    },
    agents: {
      weather: weatherAgent,
      recipeSearch: recipeSearchAgent,
      mealPlanSelector: mealPlanSelectorAgent,
      mealPlanGenerator: mealPlanGeneratorAgent,
      mealPlanEmailFormatter: mealPlanEmailFormatterAgent,
      shoppingList: shoppingListAgent,
      shoppingListSummary: shoppingListSummaryAgent,
      notification: notificationAgent,
      coding: codingAgent,
      requirementsInterviewer: requirementsInterviewerAgent,
    },
  });
}

export const mastra = await createMastra();
