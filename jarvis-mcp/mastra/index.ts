
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { weatherAgent } from './agents/weather-agent';
import { 
  recipeSearchAgent, 
  mealPlanSelectorAgent, 
  mealPlanGeneratorAgent, 
  mealPlanEmailFormatterAgent 
} from './agents/cooking-agent';
import { weatherMonitoringWorkflow } from './workflows/weather-workflows';
import { weeklyMealPlanningWorkflow } from './workflows/cooking-workflows';
import { sqlStorageProvider } from './storage';

export const mastra = new Mastra({
  storage: sqlStorageProvider,
  workflows: { 
    weatherMonitoringWorkflow,
    weeklyMealPlanningWorkflow,
  },
  agents: { 
    weather: weatherAgent,
    recipeSearch: recipeSearchAgent,
    mealPlanSelector: mealPlanSelectorAgent,
    mealPlanGenerator: mealPlanGeneratorAgent,
    mealPlanEmailFormatter: mealPlanEmailFormatterAgent,
  },
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
});