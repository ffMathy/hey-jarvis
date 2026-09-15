import { beforeAll, describe, it } from 'bun:test';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { Agent } from '@mastra/core/agent';
import { generateObject } from 'ai';
import { z } from 'zod';
import { createAgent } from '../../utils/index.js';
import { isOllamaAvailable } from '../../utils/providers/ollama-provider.js';
import { SUPERVISOR_INSTRUCTIONS } from './agents.js';

/**
 * LLM-evaluated routing decisions.
 *
 * These tests exercise the real supervisor: they give it a set of stand-in agents, let it
 * decide what to delegate, and judge those delegations with an LLM.
 *
 * They used to judge a task DAG. The DAG is gone — ordering, parallelism and dependency
 * passing are the supervisor's own delegation loop now — so what is judged is the sequence
 * of delegations it actually made, which is the same routing decision expressed differently.
 * A dependency is no longer an edge in a graph; it shows up as a second delegation whose
 * prompt carries the first one's answer.
 */

/** One delegation the supervisor made, as the hooks observe it. */
interface ObservedDelegation {
  agentId: string;
  prompt: string;
  result?: string;
}

interface EvaluationResult {
  passed: boolean;
  score: number;
  reasoning: string;
}

async function evaluateDelegations(
  delegations: ObservedDelegation[],
  userQuery: string,
  criteria: string,
): Promise<EvaluationResult> {
  const apiKey = process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error('Google API key required: set HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY');
  }

  const google = createGoogleGenerativeAI({ apiKey });

  const schema = z.object({
    passed: z.boolean().describe('Whether the criteria was met'),
    score: z.number().min(0).max(1).describe('Confidence score from 0 to 1'),
    reasoning: z.string().describe('Explanation of why the criteria was or was not met'),
  });

  const transcript = delegations
    .map(
      (delegation, index) =>
        `${index + 1}. Delegated to "${delegation.agentId}"
   Prompt: ${delegation.prompt}
   Answered: ${delegation.result ?? '(still running)'}`,
    )
    .join('\n\n');

  const result = await generateObject({
    model: google('gemini-flash-latest'),
    temperature: 0,
    schema,
    maxRetries: 3,
    prompt: `You are evaluating whether a routing agent delegated a user's request to the right specialized agents, in the right order.

USER QUERY:
\`\`\`
${userQuery}
\`\`\`

DELEGATIONS THE ROUTER MADE, IN ORDER:
\`\`\`
${transcript}
\`\`\`

EVALUATION CRITERIA:
\`\`\`
${criteria}
\`\`\`

Consider:
- Which agents were chosen, and whether each was the right one for that part of the request
- The order of the delegations
- Whether a delegation that needed a value from an earlier one actually carries that value in its prompt
- Whether any delegation was unnecessary

Respond with:
- "passed" (boolean): Whether the criteria is met
- "score" (number 0-1): Confidence score
- "reasoning" (string): Clear explanation citing specific delegations`,
  });

  return result.object;
}

async function assertDelegationCriteria(
  delegations: ObservedDelegation[],
  userQuery: string,
  criteria: string,
  minScore = 0.7,
): Promise<void> {
  const result = await evaluateDelegations(delegations, userQuery, criteria);

  if (!result.passed || result.score < minScore) {
    throw new Error(
      `Routing failed to meet criteria (scored: ${result.score} but needed: ${minScore}):\n` +
        `Criteria: ${criteria}\n` +
        `Reasoning: ${result.reasoning}\n\n` +
        `Delegations:\n${JSON.stringify(delegations, null, 2)}`,
    );
  }

  console.debug('✅ ', criteria, '\n', JSON.stringify(delegations, null, 2), '\n', result);
}

/**
 * A stand-in for one of the routable agents: real enough for the supervisor to delegate to,
 * trivial enough that its answer is fixed and the routing decision is what is being judged.
 */
async function createStandInAgent(id: string, description: string, answer: string): Promise<Agent> {
  return createAgent({
    id,
    name: id,
    description,
    instructions: `You are a stand-in for the ${id} agent in a test. Whatever you are asked, reply with exactly: ${answer}`,
    memory: undefined,
  });
}

/** Runs the supervisor over a query and records every delegation it makes. */
async function route(userQuery: string, agents: Agent[]): Promise<ObservedDelegation[]> {
  const delegations: ObservedDelegation[] = [];

  const supervisor = await createAgent({
    id: 'routing-supervisor-under-test',
    name: 'RoutingSupervisorUnderTest',
    instructions: SUPERVISOR_INSTRUCTIONS,
    agents: Object.fromEntries(agents.map((agent) => [agent.id, agent])),
    memory: undefined,
  });

  await supervisor.generate(userQuery, {
    maxSteps: 10,
    delegation: {
      onDelegationStart: (context) => {
        delegations.push({ agentId: context.primitiveId, prompt: context.prompt });
      },
      onDelegationComplete: (context) => {
        const observed = delegations.find(
          (delegation) => delegation.agentId === context.primitiveId && delegation.result === undefined,
        );
        if (observed) {
          observed.result = context.result.text;
        }
      },
    },
  });

  return delegations;
}

const WEATHER_DESCRIPTION = `# Purpose
Provide weather data. Use this tool to **fetch the current conditions** or a **5-day forecast** for any location specified by city name, postal/ZIP code, or latitude/longitude coordinates.

**Location is mandatory and must be provided - the weather agent cannot tell a user's location.**

# When to use
- The user asks about today's weather, tomorrow's forecast, or the outlook for specific dates.
- The user needs details for planning travel or outdoor activities.`;

const IOT_DESCRIPTION = `# Purpose
Control and monitor Internet of Things (IoT) devices. Use this agent to **turn devices on/off**, **adjust settings**, **query device states**, **get user locations via their phones**, and **view historical changes**.

# When to use
- You want to control IOT devices (lights, switches, climate control, media players, scenes).
- You ask about the current state of devices.
- You need to access user location data for location-based automations.`;

describe('Routing - LLM Evaluated', () => {
  let ollamaAvailable = false;

  beforeAll(async () => {
    ollamaAvailable = await isOllamaAvailable();
    if (!ollamaAvailable) {
      console.warn('Skipping routing LLM eval tests: Ollama is not available');
    }
  });

  it('looks up the location before the weather when the user does not give one', async () => {
    if (!ollamaAvailable) {
      return;
    }

    const userQuery = 'Check the weather for my current location';
    const delegations = await route(userQuery, [
      await createStandInAgent('weather', WEATHER_DESCRIPTION, 'It is 8 degrees and raining.'),
      await createStandInAgent('internetOfThings', IOT_DESCRIPTION, 'The user is in Aarhus, Denmark.'),
    ]);

    await assertDelegationCriteria(
      delegations,
      userQuery,
      `The router should:
1. Delegate to internetOfThings first to find the user's current location, since the weather agent cannot determine it
2. Then delegate to weather
3. The weather delegation's prompt MUST contain the location that internetOfThings answered with (Aarhus), because the weather agent is told it cannot work out a location itself

The key validation is that the weather delegation happened after the location lookup and carries its answer.`,
      0.8,
    );
  }, 120000);

  it('does not look up a location the user already gave', async () => {
    if (!ollamaAvailable) {
      return;
    }

    const userQuery = 'What is the weather in Copenhagen?';
    const delegations = await route(userQuery, [
      await createStandInAgent('weather', WEATHER_DESCRIPTION, 'It is 8 degrees and raining.'),
      await createStandInAgent('internetOfThings', IOT_DESCRIPTION, 'The user is in Aarhus, Denmark.'),
    ]);

    await assertDelegationCriteria(
      delegations,
      userQuery,
      `The router should delegate to the weather agent with Copenhagen as the location, and should NOT delegate to internetOfThings at all — the user already supplied the location, so looking it up is work nobody asked for.`,
      0.8,
    );
  }, 120000);

  it('delegates independent parts of a request separately', async () => {
    if (!ollamaAvailable) {
      return;
    }

    const userQuery = 'What is the weather in Copenhagen, and are the lights on?';
    const delegations = await route(userQuery, [
      await createStandInAgent('weather', WEATHER_DESCRIPTION, 'It is 8 degrees and raining.'),
      await createStandInAgent('internetOfThings', IOT_DESCRIPTION, 'The hallway light is on.'),
    ]);

    await assertDelegationCriteria(
      delegations,
      userQuery,
      `The router should delegate the weather question to the weather agent and the lights question to internetOfThings. Neither delegation depends on the other, so neither prompt needs to carry the other's answer.`,
      0.8,
    );
  }, 120000);
});
