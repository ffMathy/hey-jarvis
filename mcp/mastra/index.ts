import { Mastra } from '@mastra/core';
import { PinoLogger } from '@mastra/loggers';
import { Observability } from '@mastra/observability';
import { getSqlStorageProvider } from './storage/index.js';
import {
  getCalendarAgent,
  getCodingAgent,
  getCommuteAgent,
  getEmailAgent,
  getEmailParsingAgent,
  getInternetOfThingsAgent,
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
  checkForFormRepliesWorkflow,
  checkForNewEmails,
  humanInTheLoopDemoWorkflow,
  implementFeatureWorkflow,
  stateChangeNotificationWorkflow,
  weatherMonitoringWorkflow,
  weeklyMealPlanningWorkflow,
} from './verticals/index.js';

async function createMastra() {
  // Set up the Google AI SDK environment variable
  process.env['GOOGLE_GENERATIVE_AI_API_KEY'] = process.env['HEY_JARVIS_GOOGLE_API_KEY'] || '';

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
    emailParsingAgent,
    todoListAgent,
    calendarAgent,
    webResearchAgent,
    homeAssistantAgent,
    commuteAgent,
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
    getEmailParsingAgent(),
    getTodoListAgent(),
    getCalendarAgent(),
    getWebResearchAgent(),
    getInternetOfThingsAgent(),
    getCommuteAgent(),
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
      humanInTheLoopDemoWorkflow,
      checkForFormRepliesWorkflow,
      checkForNewEmails,
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
      emailResponseParser: emailParsingAgent,
      todoList: todoListAgent,
      calendar: calendarAgent,
      webResearch: webResearchAgent,
      homeAssistant: homeAssistantAgent,
      commute: commuteAgent,
    },
  });
}

export const mastra = await createMastra();