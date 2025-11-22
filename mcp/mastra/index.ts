import { Mastra } from '@mastra/core';
import { PinoLogger } from '@mastra/loggers';
import { Observability } from '@mastra/observability';
import { getSqlStorageProvider } from './storage/index.js';
import {
  getCalendarAgent,
  getCodingAgent,
  getEmailAgent,
  getHomeAssistantAgent,
  getMealPlanEmailFormatterAgent,
  getMealPlanGeneratorAgent,
  getMealPlanSelectorAgent,
  getNotificationAgent,
  getRecipeSearchAgent,
  getRequirementsInterviewerAgent,
  getShoppingListAgent,
  getShoppingListSummaryAgent,
  getStateChangeReactorAgent,
  getTodoListAgent,
  getWeatherAgent,
  getWebResearchAgent,
  implementFeatureWorkflow,
  stateChangeNotificationWorkflow,
  weatherMonitoringWorkflow,
  weeklyMealPlanningWorkflow,
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
    stateChangeReactorAgent,
    codingAgent,
    requirementsInterviewerAgent,
    emailAgent,
    todoListAgent,
    calendarAgent,
    webResearchAgent,
    homeAssistantAgent,
  ] = await Promise.all([
    getWeatherAgent(),
    getRecipeSearchAgent(),
    getMealPlanSelectorAgent(),
    getMealPlanGeneratorAgent(),
    getMealPlanEmailFormatterAgent(),
    getShoppingListAgent(),
    getShoppingListSummaryAgent(),
    getNotificationAgent(),
    getStateChangeReactorAgent(),
    getCodingAgent(),
    getRequirementsInterviewerAgent(),
    getEmailAgent(),
    getTodoListAgent(),
    getCalendarAgent(),
    getWebResearchAgent(),
    getHomeAssistantAgent(),
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
      stateChangeNotificationWorkflow,
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
      stateChangeReactor: stateChangeReactorAgent,
      coding: codingAgent,
      requirementsInterviewer: requirementsInterviewerAgent,
      email: emailAgent,
      todoList: todoListAgent,
      calendar: calendarAgent,
      webResearch: webResearchAgent,
      homeAssistant: homeAssistantAgent,
    },
  });
}

export const mastra = await createMastra();
