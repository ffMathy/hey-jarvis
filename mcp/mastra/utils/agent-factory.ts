import { Agent, type AgentConfig } from '@mastra/core/agent';
import type { OutputProcessor } from '@mastra/core/processors';
import { createMemory } from '../memory/index.js';
import { google } from './google-provider.js';
import { getDefaultScorers } from './scorers-config.js';

/**
 * Type for agent configuration used by both createAgent and createLightAgent
 */
type AgentConfigInput = Omit<AgentConfig, 'model' | 'memory' | 'scorers'> & {
  model?: AgentConfig['model'];
  memory?: AgentConfig['memory'];
  scorers?: AgentConfig['scorers'];
};

/**
 * Internal helper to create an agent with a specified model
 */
async function createAgentWithModel(config: AgentConfigInput, defaultModel: AgentConfig['model']): Promise<Agent> {
  const DEFAULT_AGENT_CONFIG: Partial<AgentConfig> = {
    // Use shared memory instance by default
    memory: await createMemory(),
    // Use the specified default model
    model: defaultModel,
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
  } as AgentConfig;

  return new Agent(mergedConfig);
}

/**
 * Creates an agent using the default model (Gemini Flash Latest).
 * Use this for interactive agents that require high-quality responses.
 */
export async function createAgent(config: AgentConfigInput): Promise<Agent> {
  return createAgentWithModel(config, google('gemini-flash-latest'));
}

/**
 * Creates an agent using a light model (Gemma 3 27B).
 * Use this for automated/scheduled tasks where cost-efficiency is preferred.
 *
 * Recommended for:
 * - State change reactor agents
 * - Scheduler-triggered workflow agents
 * - Background processing tasks
 */
export async function createLightAgent(config: AgentConfigInput): Promise<Agent> {
  return createAgentWithModel(config, google('gemma-3-27b-it'));
}
