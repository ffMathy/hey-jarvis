import { Agent, type AgentConfig } from '@mastra/core/agent';
import type { OutputProcessor } from '@mastra/core/processors';
import { createMemory } from '../memory/index.js';
import { google } from './google-provider.js';
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
    // Use Google Gemini Flash Latest as the default model with our configured provider
    model: google('gemini-flash-latest'),
    // Use default scorers for comprehensive evaluation
    scorers: getDefaultScorers(),
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
  } as AgentConfig;

  return new Agent(mergedConfig);
}
