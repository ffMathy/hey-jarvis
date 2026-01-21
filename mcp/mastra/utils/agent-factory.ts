import { Agent, type AgentConfig } from '@mastra/core/agent';
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
  const defaultProcessors: readonly OutputProcessor[] = DEFAULT_AGENT_CONFIG.outputProcessors || [];
  const customProcessors: readonly OutputProcessor[] = config.outputProcessors || [];

  const mergedConfig: AgentConfig = {
    ...DEFAULT_AGENT_CONFIG,
    ...config,
    model: config.model || DEFAULT_AGENT_CONFIG.model!,
    memory: config.memory || DEFAULT_AGENT_CONFIG.memory,
    scorers: config.scorers || DEFAULT_AGENT_CONFIG.scorers,
    // Merge output processors instead of replacing
    outputProcessors: [...defaultProcessors, ...customProcessors],
    // Use name as id if id not provided
    id: config.id || config.name || 'default-agent',
  };

  return new Agent(mergedConfig);
}
