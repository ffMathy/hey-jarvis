import { Mastra } from "@mastra/core";
import { PinoLogger } from "@mastra/loggers";
import { getSqlStorageProvider } from "./storage/index.js";
import {
  getMealPlanEmailFormatterAgent,
  getMealPlanGeneratorAgent,
  getMealPlanSelectorAgent,
  getNotificationAgent,
  notificationWorkflow,
  getRecipeSearchAgent,
  getShoppingListAgent,
  getShoppingListSummaryAgent,
  shoppingListWorkflow,
  getWeatherAgent,
  weatherMonitoringWorkflow,
  weeklyMealPlanningWorkflow
} from "./verticals/index.js";

async function createMastra() {
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
    notificationAgent
  ] = await Promise.all([
    getWeatherAgent(),
    getRecipeSearchAgent(),
    getMealPlanSelectorAgent(),
    getMealPlanGeneratorAgent(),
    getMealPlanEmailFormatterAgent(),
    getShoppingListAgent(),
    getShoppingListSummaryAgent(),
    getNotificationAgent()
  ]);

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