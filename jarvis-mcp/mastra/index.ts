
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { weatherAgent } from './agents/weather-agent';
import { weatherWorkflow, weatherMonitoringWorkflow } from './workflows/weather-workflow';

export const mastra = new Mastra({
  workflows: { 
    weatherWorkflow,
    weatherMonitoringWorkflow,
  },
  agents: { 
    weatherAgent,
  },
  storage: new LibSQLStore({
    // stores telemetry, evals, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: ":memory:",
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
});
