import { Mastra } from "@mastra/core";
import { PinoLogger } from "@mastra/loggers";
import { Observability } from "@mastra/observability";
import { getSqlStorageProvider } from "./storage/index.js";
import {
  getCodingAgent,
  getMealPlanEmailFormatterAgent,
  getMealPlanGeneratorAgent,
  getMealPlanSelectorAgent,
  getNotificationAgent,
  getRecipeSearchAgent,
  getShoppingListAgent,
  getShoppingListSummaryAgent,
  getWeatherAgent,
  notificationWorkflow,
  shoppingListWorkflow,
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
    notificationAgent,
    codingAgent
  ] = await Promise.all([
    getWeatherAgent(),
    getRecipeSearchAgent(),
    getMealPlanSelectorAgent(),
    getMealPlanGeneratorAgent(),
    getMealPlanEmailFormatterAgent(),
    getShoppingListAgent(),
    getShoppingListSummaryAgent(),
    getNotificationAgent(),
    getCodingAgent()
  ]);

  return new Mastra({
    storage: sqlStorageProvider,
    logger: new PinoLogger({
      name: "Mastra",
      level: "info",
    }),
    observability: new Observability({ default: { enabled: true } }),
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
      coding: codingAgent,
    }
  });
}

export const mastra = await createMastra();