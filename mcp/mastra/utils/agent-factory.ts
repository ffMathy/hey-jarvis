import { Agent, type AgentConfig } from '@mastra/core/agent';
import type { IMastraLogger } from '@mastra/core/logger';
import type { OutputProcessor } from '@mastra/core/processors';
import { createMemory } from '../memory/index.js';
import { getModel } from './providers/github-models-provider.js';
import { getDefaultScorers } from './scorers-config.js';

export async function createAgent(
  config: Omit<AgentConfig, 'model' | 'memory' | 'scorers'> & {
    model?: AgentConfig['model'];
    memory?: AgentConfig['memory'];
    scorers?: AgentConfig['scorers'];
  },
): Promise<Agent> {
  const DEFAULT_AGENT_CONFIG: Partial<AgentConfig> = {
    // Use shared memory instance by default
    memory: await createMemory(),
    // Use GitHub Models in CI or Google Gemini for production
    model: getModel('gemini-flash-latest'),
    // Use default scorers for comprehensive evaluation
    scorers: getDefaultScorers(),
    instructions: `${config.instructions}\n\n# Additional context and guidelines\nNever ask questions. Always make best-guess assumptions.\nThe time is currently: \`${new Date().toString()}\`.`,
    inputProcessors: [],
    outputProcessors: [
      // Add error reporting processor to all agents by default
      // Cast to OutputProcessor since TypeScript can't infer it implements processOutputResult
      // createErrorReportingProcessor({
      //   repo: 'hey-jarvis',
      //   labels: ['automated-error', config.name || 'unknown-agent'],
      // }),
    ],
  };

  // Explicitly merge output processors to avoid type inference issues
  const defaultProcessors = (DEFAULT_AGENT_CONFIG.outputProcessors || []) as OutputProcessor[];
  const customProcessors = (config.outputProcessors || []) as OutputProcessor[];

  const mergedConfig: AgentConfig = {
    ...DEFAULT_AGENT_CONFIG,
    ...config,
    // Merge output processors instead of replacing
    outputProcessors: [...defaultProcessors, ...customProcessors],
    // Use name as id if id not provided
    id: config.id || config.name || 'default-agent',
  } as AgentConfig;

  const agent = new Agent(mergedConfig);

  // Workaround for @mastra/core@1.0.0-beta.21 bug where Mastra.constructor
  // calls __setLogger on agents but Agent class doesn't have this method
  // This adds the missing method to maintain compatibility
  if (!(agent as any).__setLogger || typeof (agent as any).__setLogger !== 'function') {
    (agent as any).__setLogger = (logger: IMastraLogger) => {
      // Store logger reference if needed by agent internals
      (agent as any)._logger = logger;
    };
  }

  return agent;
}
