import { Mastra } from "@mastra/core";
import { getSqlStorageProvider } from "./storage/index.js";
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
} from "./verticals/index.js";

async function createMastra() {
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
    }
  });
}

export const mastra = await createMastra();