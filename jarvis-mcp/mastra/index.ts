
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { weatherAgent } from './agents/weather-agent';
import { weatherMonitoringWorkflow } from './workflows/weather-workflows';
import { sqlStorageProvider } from './storage';

export const mastra = new Mastra({
  storage: sqlStorageProvider,
  workflows: { 
    weatherMonitoringWorkflow,
  },
  agents: { 
    weatherAgent,
  },
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
});
