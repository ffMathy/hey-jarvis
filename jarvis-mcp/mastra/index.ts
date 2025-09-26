
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { weatherAgent } from './agents/weather-agent';
import { weatherMonitoringWorkflow } from './workflows/weather-workflows';

export const mastra = new Mastra({
  storage: new LibSQLStore({
    url: ":memory:"
  }),
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
