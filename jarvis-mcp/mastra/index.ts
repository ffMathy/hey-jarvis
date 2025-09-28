
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { sqlStorageProvider } from './storage';
import { jwtAuth } from './utils';
import {
  apiAuthenticationWorkflow,
  jwtAuthAgent,
  mealPlanEmailFormatterAgent,
  mealPlanGeneratorAgent,
  mealPlanSelectorAgent,
  recipeSearchAgent,
  shoppingListAgent,
  shoppingListSummaryAgent,
  shoppingListWorkflow,
  userAuthenticationWorkflow,
  weatherAgent,
  weatherMonitoringWorkflow,
  weeklyMealPlanningWorkflow
} from './verticals';

export const mastra = new Mastra({
  storage: sqlStorageProvider,
  workflows: {
    userAuthenticationWorkflow,
    apiAuthenticationWorkflow,
    weatherMonitoringWorkflow,
    weeklyMealPlanningWorkflow,
    shoppingListWorkflow,
  },
  agents: {
    jwtAuth: jwtAuthAgent,
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
  // JWT Authentication configuration
  auth: {
    jwt: jwtAuth ? {
      verify: (token: string) => jwtAuth.verifyToken(token),
      extract: (headers: Record<string, any>) => jwtAuth.extractAuthContext(headers),
    } : undefined,
  },
});