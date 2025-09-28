
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { sqlStorageProvider } from './storage';
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
  weeklyMealPlanningWorkflow,
  regenerateMealPlanWorkflow
} from './verticals';

export const mastra = new Mastra({
  storage: sqlStorageProvider,
  workflows: {
    weatherMonitoringWorkflow,
    weeklyMealPlanningWorkflow,
    regenerateMealPlanWorkflow,
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