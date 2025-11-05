
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { getSqlStorageProvider } from './storage/index.js';
import {
  mealPlanEmailFormatterAgent,
  mealPlanGeneratorAgent,
  mealPlanSelectorAgent,
  recipeSearchAgent,
  shoppingListAgent,
  shoppingListSummaryAgent,
  shoppingListWorkflow,
  weatherAgent,
  weatherMonitoringWorkflow,
  weeklyMealPlanningWorkflow
} from './verticals/index.js';

export async function createMastra() {
  const sqlStorageProvider = await getSqlStorageProvider();

  return new Mastra({
    storage: sqlStorageProvider,
    workflows: {
      weatherMonitoringWorkflow,
      weeklyMealPlanningWorkflow,
      shoppingListWorkflow,
    },
    agents: {
      weather: weatherAgent,
      recipeSearch: recipeSearchAgent,
      mealPlanSelector: mealPlanSelectorAgent,
      mealPlanGenerator: mealPlanGeneratorAgent,
      mealPlanEmailFormatter: mealPlanEmailFormatterAgent,
      shoppingList: shoppingListAgent,
      shoppingListSummary: shoppingListSummaryAgent,
    },
    logger: new PinoLogger({
      name: 'Mastra',
      level: 'info',
    }),
  });
}