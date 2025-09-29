import { google } from '@ai-sdk/google';
import { Agent, AgentConfig } from '@mastra/core/agent';
import { createMemory } from '../memory';
import { DEFAULT_SCORERS } from './scorers-config';
export function createAgent(
    config: Omit<AgentConfig, 'model' | 'memory' | 'scorers'> & {
        model?: AgentConfig['model'];
        memory?: AgentConfig['memory'];
        scorers?: AgentConfig['scorers']
    }
): Agent {
    const DEFAULT_AGENT_CONFIG: Partial<AgentConfig> = {
        // Use shared memory instance by default
        memory: createMemory(),
        // Use Google Gemini Flash Latest as the default model
        model: google('gemini-flash-latest'),
        // Use default scorers for comprehensive evaluation
        scorers: DEFAULT_SCORERS,
    };

    const mergedConfig: AgentConfig = {
        ...DEFAULT_AGENT_CONFIG,
        ...config,
    } as AgentConfig;

    return new Agent(mergedConfig);
}