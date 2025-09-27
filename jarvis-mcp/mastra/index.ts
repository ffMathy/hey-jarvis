
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { weatherAgent } from './agents/weather-agent';
import { 
  recipeSearchAgent, 
  mealPlanSelectorAgent, 
  mealPlanGeneratorAgent, 
  mealPlanEmailFormatterAgent 
} from './agents/cooking-agent';
import { 
  shoppingListAgent,
  shoppingListSummaryAgent 
} from './agents/shopping-agent';
import { weatherMonitoringWorkflow } from './workflows/weather-workflows';
import { weeklyMealPlanningWorkflow } from './workflows/cooking-workflows';
import { shoppingListWorkflow } from './workflows/shopping-workflows';
import { sqlStorageProvider } from './storage';

export const mastra = new Mastra({
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