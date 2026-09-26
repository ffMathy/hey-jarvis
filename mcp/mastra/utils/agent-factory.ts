import { Agent, type AgentConfig } from '@mastra/core/agent';
import type { OutputProcessor } from '@mastra/core/processors';
import { createMemory } from '../memory/index.js';
import { getModel } from './providers/google-provider.js';
import { getDefaultScorers } from './scorers-config.js';

/**
 * How many steps an agent gets before the run is stopped.
 *
 * Mastra's own default is five, and a step is one turn of the tool loop — so an agent that
 * needs a fifth tool call never gets to write its answer. The run does not fail when that
 * happens: it ends on a tool-calls step, and what comes back is an empty string. Routing
 * reports that as "finished without answering" (see `verticals/routing/controller.ts`), which
 * is what the calendar was doing to every request that asked it for a week at a time — enough
 * calls to enumerate the calendars, none left to answer with.
 *
 * Twenty is Mastra's own ceiling for its durable and network agents, and it is about the right
 * shape here: enough for an agent to walk a household's worth of calendars, emails or devices
 * and still speak, while remaining a bound on a model that has started looping.
 */
const MAX_AGENT_STEPS = 20;

/**
 * An agent's own instructions, followed by the guidelines every agent is given.
 *
 * Called for every request rather than once when the agent is built. Agents are built once, at
 * boot, and the server stays up for days, so a time taken at construction is days stale by the
 * time anyone asks what is on tomorrow.
 */
function withSharedGuidelines(instructions: string): string {
  const guidelines = [
    'Never ask questions. Always make best-guess assumptions.',
    `The time is currently: \`${new Date().toString()}\`.`,
  ];

  return `${instructions}\n\n# Additional context and guidelines\n${guidelines.join('\n')}`;
}

export async function createAgent(
  config: Omit<AgentConfig, 'model' | 'memory' | 'scorers' | 'instructions'> & {
    /**
     * The agent's own instructions. The guidelines every agent shares are appended to them.
     *
     * A function is resolved on every call, for instructions that carry something looked up at
     * request time -- the Home Assistant areas the IoT agent can target, say.
     */
    instructions: string | (() => Promise<string>);
    model?: AgentConfig['model'];
    memory?: AgentConfig['memory'];
    scorers?: AgentConfig['scorers'];
  },
): Promise<Agent> {
  const { instructions, ...agentConfig } = config;

  const DEFAULT_AGENT_CONFIG: Partial<AgentConfig> = {
    // Use shared memory instance by default
    memory: await createMemory(),
    // Google Gemini across all environments
    model: getModel('gemini-flash-latest'),
    // Use default scorers for comprehensive evaluation
    scorers: getDefaultScorers(),
    // Use temperature 0 for deterministic outputs across all agents, and give the tool loop
    // room to finish -- see MAX_AGENT_STEPS.
    defaultOptions: {
      modelSettings: { temperature: 0 },
      maxSteps: MAX_AGENT_STEPS,
    },
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

  const resolvedModel = config.model ?? DEFAULT_AGENT_CONFIG.model;

  const mergedConfig: AgentConfig = {
    ...DEFAULT_AGENT_CONFIG,
    ...agentConfig,
    // After the spread, so the caller's bare instructions cannot replace the guidelines. Mastra
    // resolves a function on every call, which is what keeps the time current.
    instructions:
      typeof instructions === 'string'
        ? () => withSharedGuidelines(instructions)
        : async () => withSharedGuidelines(await instructions()),
    model: resolvedModel,
    // Merge output processors instead of replacing
    outputProcessors: [...defaultProcessors, ...customProcessors],
    // Use name as id if id not provided
    id: config.id || config.name || 'default-agent',
    // Explicitly merge defaultOptions so caller overrides are preserved on top of defaults
    defaultOptions: {
      ...DEFAULT_AGENT_CONFIG.defaultOptions,
      ...config.defaultOptions,
    },
  } as AgentConfig;

  return new Agent(mergedConfig);
}
