import { Mastra } from "@mastra/core";
import { getSqlStorageProvider } from "./storage/index.js";
import {
  mealPlanEmailFormatterAgent,
  mealPlanGeneratorAgent,
  mealPlanSelectorAgent,
  notificationAgent,
  notificationWorkflow,
  recipeSearchAgent,
  shoppingListAgent,
  shoppingListSummaryAgent,
  shoppingListWorkflow,
  weatherAgent,
  weatherMonitoringWorkflow,
  weeklyMealPlanningWorkflow
} from "./verticals/index.js";

async function createMastra() {
  const sqlStorageProvider = await getSqlStorageProvider();

  return new Mastra({
    storage: sqlStorageProvider,
    workflows: {
      weatherMonitoringWorkflow,
      weeklyMealPlanningWorkflow,
      shoppingListWorkflow,
      notificationWorkflow,
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
    }
  });
}

export const mastra = await createMastra();