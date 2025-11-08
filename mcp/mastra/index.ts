import { Mastra } from "@mastra/core";
import { PinoLogger } from "@mastra/loggers";
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
    logger: new PinoLogger({
      name: "Mastra",
      level: "info",
    }),
    observability: {
      default: { enabled: true }, // Enables AI Tracing with DefaultExporter
    },
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