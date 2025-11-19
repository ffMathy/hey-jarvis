import { Agent, AgentConfig } from '@mastra/core/agent';
import { createMemory } from '../memory/index.js';
import { google } from './google-provider.js';
import { getDefaultScorers } from './scorers-config.js';
import { createErrorReportingProcessor } from '../processors/index.js';

export async function createAgent(
    config: Omit<AgentConfig, 'model' | 'memory' | 'scorers'> & {
        model?: AgentConfig['model'];
        memory?: AgentConfig['memory'];
        scorers?: AgentConfig['scorers']
    }
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
            createErrorReportingProcessor({
                repo: 'hey-jarvis',
                labels: ['automated-error', config.name || 'unknown-agent'],
            }),
        ],
    };

    const mergedConfig: AgentConfig = {
        ...DEFAULT_AGENT_CONFIG,
        ...config,
        // Merge output processors instead of replacing
        outputProcessors: [
            ...(DEFAULT_AGENT_CONFIG.outputProcessors || []),
            ...(config.outputProcessors || []),
        ],
    } as AgentConfig;

    return new Agent(mergedConfig);
}