import { google } from '@ai-sdk/google';
import { Agent, AgentConfig } from '@mastra/core/agent';
import { memory } from '../memory';

/**
 * Default configuration values for all agents in the Hey Jarvis system.
 * These can be overridden on a per-agent basis when needed.
 */
const DEFAULT_AGENT_CONFIG: Partial<AgentConfig> = {
    // Use shared memory instance by default
    memory: memory,
    // Use Google Gemini Flash Latest as the default model
    model: google('gemini-flash-latest'),
};

/**
 * Creates a new Mastra Agent with sensible defaults for the Hey Jarvis system.
 * 
 * This is a proxy method to the Mastra Agent constructor that allows us to:
 * - Apply consistent defaults across all agents
 * - Easily modify default behavior in the future
 * - Maintain a single point of agent configuration
 * 
 * @param config - The agent configuration object (model and memory are optional as they're provided by defaults)
 * @returns A new Agent instance with applied defaults
 * 
 * @example
 * ```typescript
 * import { createAgent } from '../utils/agent-factory';
 * import { myTools } from './tools';
 * 
 * export const myAgent = createAgent({
 *   name: 'MyAgent',
 *   instructions: 'You are a helpful agent...',
 *   tools: myTools,
 *   // memory and model are automatically provided from defaults
 * });
 * ```
 */
export function createAgent(config: Omit<AgentConfig, 'model' | 'memory'> & { model?: AgentConfig['model']; memory?: AgentConfig['memory'] }): Agent {
    // Merge the provided config with defaults
    // User-provided values override defaults
    const mergedConfig: AgentConfig = {
        ...DEFAULT_AGENT_CONFIG,
        ...config,
    } as AgentConfig;

    return new Agent(mergedConfig);
}