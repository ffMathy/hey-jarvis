import { Agent, type AgentConfig } from '@mastra/core/agent';
import type { OutputProcessor } from '@mastra/core/processors';
import { createMemory } from '../memory/index.js';
import { getModel } from './providers/google-provider.js';
import { getDefaultScorers } from './scorers-config.js';

/**
 * How many model round trips an agent gets before the loop is cut off.
 *
 * **Mastra's default is five, and five is not a decision anybody here made.** A routed delegation
 * is a bare `{ type: 'agent' }` entry in a generated plan — `verticals/routing/plan.ts` — which
 * carries no options, and Mastra's serialised graph entry has nowhere to put a step budget anyway.
 * It ends at `stopWhen ?? stepCountIs(5)`, and a loop cut off on a tool-call step returns no text
 * at all: the caller gets an agent that succeeded and said nothing, which
 * `verticals/routing/controller.ts` reports as "finished without answering".
 *
 * The repository already knows this failure and already guards against it — once.
 * `verticals/synapse/reactor-run.ts` passes `maxSteps: 10` and says in as many words that "empty
 * means it finished without saying anything". Every other agent, including every agent a routing
 * plan delegates to, was left on the default. Setting it here is that same guard, applied where
 * agents are made rather than at one call site that happened to hit the problem first.
 *
 * Ten, matching the reactor, because it is a ceiling and not a target: a question answered in two
 * round trips still costs two. What it buys is room for an agent whose vertical needs several —
 * looking up which calendars exist before reading any of them, say — to finish its sentence.
 */
const DELEGATED_MAX_STEPS = 10;

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
    // Google Gemini across all environments
    model: getModel('gemini-flash-latest'),
    // Use default scorers for comprehensive evaluation
    scorers: getDefaultScorers(),
    // Use temperature 0 for deterministic outputs across all agents
    defaultOptions: {
      modelSettings: { temperature: 0 },
      maxSteps: DELEGATED_MAX_STEPS,
    },
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

  const resolvedModel = config.model ?? DEFAULT_AGENT_CONFIG.model;

  const mergedConfig: AgentConfig = {
    ...DEFAULT_AGENT_CONFIG,
    ...config,
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
