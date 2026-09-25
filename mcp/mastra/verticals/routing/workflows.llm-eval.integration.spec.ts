import { beforeAll, describe, expect, it } from 'bun:test';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { Agent } from '@mastra/core/agent';
import { generateObject } from 'ai';
import { z } from 'zod';
import { createAgent } from '../../utils/index.js';
import { isOllamaAvailable } from '../../utils/providers/ollama-provider.js';
import type { PlannedChain } from './plan.js';
import { plannerInstructions, plannerPrompt, planSchema } from './planner.js';
import type { OpenQuestion } from './questions.js';
import { chainsFromTasks } from './task-chains.js';

/**
 * LLM-evaluated routing decisions.
 *
 * These tests exercise the real planner instructions: they give it a set of stand-in agents,
 * let it write a plan, and judge that plan with an LLM.
 *
 * They used to judge a task DAG, and then the delegations a supervisor made inside its own
 * loop. What is judged now is the plan itself, which is the same routing decision expressed
 * a third way — and the most directly readable of the three, because ordering and dependency
 * are structural rather than implied.
 *
 * The planner writes a flat list of tasks and names each one's dependency; what is judged
 * here is the chains that list runs as, derived by `chainsFromTasks`. That is deliberately
 * the far side of the derivation rather than the near side: a declared edge is only worth
 * anything if it ends up sequencing the work, and the chains are where that shows.
 */

interface EvaluationResult {
  passed: boolean;
  score: number;
  reasoning: string;
}

/** The plan as a transcript the judge can read. */
function describePlan(chains: PlannedChain[]): string {
  if (chains.length === 0) {
    return '(the planner returned no chains at all)';
  }

  return chains
    .map(
      (chain, chainIndex) =>
        `Chain ${chainIndex + 1} (runs at the same time as the other chains):\n` +
        chain.delegations
          .map(
            (delegation, index) =>
              `  ${index + 1}. Delegated to "${delegation.agentId}"` +
              `${index > 0 ? ' — is handed the previous delegation’s answer automatically' : ''}\n` +
              `     Prompt: ${delegation.prompt}`,
          )
          .join('\n'),
    )
    .join('\n\n');
}

async function evaluatePlan(chains: PlannedChain[], userQuery: string, criteria: string): Promise<EvaluationResult> {
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

  const result = await generateObject({
    model: google('gemini-flash-latest'),
    temperature: 0,
    schema,
    maxRetries: 3,
    prompt: `You are evaluating whether a routing planner turned a user's request into the right plan.

A plan is a set of chains. Chains run at the same time as each other. The delegations inside one chain run in order, and every delegation after the first is automatically handed the previous one's answer along with its own prompt.

USER QUERY:
\`\`\`
${userQuery}
\`\`\`

THE PLAN:
\`\`\`
${describePlan(chains)}
\`\`\`

EVALUATION CRITERIA:
\`\`\`
${criteria}
\`\`\`

Consider:
- Which agents were chosen, and whether each was the right one for that part of the request
- Whether work that depends on another part is in the same chain, after the part it depends on
- Whether independent work is in separate chains, so it runs at once
- Whether any delegation was unnecessary

Respond with:
- "passed" (boolean): Whether the criteria is met
- "score" (number 0-1): Confidence score
- "reasoning" (string): Clear explanation citing specific delegations`,
  });

  return result.object;
}

async function assertPlanCriteria(
  chains: PlannedChain[],
  userQuery: string,
  criteria: string,
  minScore = 0.7,
): Promise<void> {
  const result = await evaluatePlan(chains, userQuery, criteria);

  if (!result.passed || result.score < minScore) {
    throw new Error(
      `Routing failed to meet criteria (scored: ${result.score} but needed: ${minScore}):\n` +
        `Criteria: ${criteria}\n` +
        `Reasoning: ${result.reasoning}\n\n` +
        `Plan:\n${JSON.stringify(chains, null, 2)}`,
    );
  }

  console.debug('✅ ', criteria, '\n', JSON.stringify(chains, null, 2), '\n', result);
}

/**
 * A stand-in for one of the routable agents: real enough to be described in the catalogue,
 * trivial enough that nothing about it but its description matters. The planner never runs
 * an agent, so a stand-in only has to exist and say what it is for.
 */
async function createStandInAgent(id: string, description: string): Promise<Agent> {
  return createAgent({
    id,
    name: id,
    description,
    instructions: `You are a stand-in for the ${id} agent in a test.`,
    memory: undefined,
  });
}

/** Asks the real planner instructions for a plan, with any questions still waiting on the user. */
async function planWithAnswers(userQuery: string, agents: Agent[], openQuestions: OpenQuestion[] = []) {
  const planner = await createAgent({
    id: 'routing-planner-under-test',
    name: 'RoutingPlannerUnderTest',
    instructions: plannerInstructions(agents),
    memory: undefined,
  });

  const response = await planner.generate(plannerPrompt(userQuery, openQuestions), {
    structuredOutput: { schema: planSchema },
    toolChoice: 'none',
  });

  if (!response.object) {
    throw new Error('The planner did not return a plan');
  }

  return {
    chains: chainsFromTasks(response.object.tasks, new Set(agents.map((agent) => agent.id))),
    answers: response.object.answers,
  };
}

/** Plans a query against a set of stand-in agents, using the real planner instructions. */
async function plan(userQuery: string, agents: Agent[]): Promise<PlannedChain[]> {
  return (await planWithAnswers(userQuery, agents)).chains;
}

const WEATHER_DESCRIPTION = `# Purpose
Provide weather data. Use this tool to **fetch the current conditions** or a **5-day forecast** for any location specified by city name, postal/ZIP code, or latitude/longitude coordinates.

**Location is mandatory and must be provided - the weather agent cannot tell a user's location.**

# When to use
- The user asks about today's weather, tomorrow's forecast, or the outlook for specific dates.
- The user needs details for planning travel or outdoor activities.`;

const CODING_DESCRIPTION = `# Purpose
Manage GitHub repositories, and implement new features, fixes and changes to the Hey Jarvis code.

# When to use
- The user wants to implement, create, add, fix, or change something in the code
- The user asks about repositories or issues`;

/** The question the requirements interview asks first, waiting for sir's reply. */
const WAITING_QUESTION: OpenQuestion = {
  id: 'q1',
  taskId: 'feature',
  agentId: 'coding',
  question: 'Should the task reminder go out by email, or as a push notification?',
  agentRunId: 'agent-run-1',
  toolCallId: 'call-1',
  answerField: 'userAnswer',
};

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

  it('chains the location lookup before the weather when the user does not give one', async () => {
    if (!ollamaAvailable) {
      return;
    }

    const userQuery = 'Check the weather for my current location';
    const chains = await plan(userQuery, [
      await createStandInAgent('weather', WEATHER_DESCRIPTION),
      await createStandInAgent('internetOfThings', IOT_DESCRIPTION),
    ]);

    await assertPlanCriteria(
      chains,
      userQuery,
      `The plan should:
1. Delegate to internetOfThings to find the user's current location, since the weather agent cannot determine it
2. Delegate to weather AFTER it, IN THE SAME CHAIN, so the weather delegation is handed the location

Two separate chains would be wrong: the weather delegation would then run without the location it needs. The key validation is that both delegations are in one chain, in that order.`,
      0.8,
    );
  }, 120000);

  it('does not look up a location the user already gave', async () => {
    if (!ollamaAvailable) {
      return;
    }

    const userQuery = 'What is the weather in Copenhagen?';
    const chains = await plan(userQuery, [
      await createStandInAgent('weather', WEATHER_DESCRIPTION),
      await createStandInAgent('internetOfThings', IOT_DESCRIPTION),
    ]);

    await assertPlanCriteria(
      chains,
      userQuery,
      `The plan should contain exactly one delegation, to the weather agent, with Copenhagen as the location. It should NOT delegate to internetOfThings at all — the user already supplied the location, so looking it up is work nobody asked for.`,
      0.8,
    );
  }, 120000);

  it('puts independent parts of a request in separate chains, so they run at once', async () => {
    if (!ollamaAvailable) {
      return;
    }

    const userQuery = 'What is the weather in Copenhagen, and are the lights on?';
    const chains = await plan(userQuery, [
      await createStandInAgent('weather', WEATHER_DESCRIPTION),
      await createStandInAgent('internetOfThings', IOT_DESCRIPTION),
    ]);

    await assertPlanCriteria(
      chains,
      userQuery,
      `The plan should have two chains of one delegation each: the weather question to the weather agent and the lights question to internetOfThings. Neither depends on the other, so putting them in one chain would make the user wait for no reason.`,
      0.8,
    );
  }, 120000);

  it('hands a reply to a waiting question back as its answer, rather than planning it as an errand', async () => {
    if (!ollamaAvailable) {
      return;
    }

    const { chains, answers } = await planWithAnswers(
      'Push, please.',
      [
        await createStandInAgent('coding', CODING_DESCRIPTION),
        await createStandInAgent('weather', WEATHER_DESCRIPTION),
      ],
      [WAITING_QUESTION],
    );

    expect(answers).toEqual([{ questionId: 'q1', answer: expect.stringMatching(/push/i) }]);
    expect(chains).toEqual([]);
  }, 120000);

  it('does not take a new request for an answer just because a question is waiting', async () => {
    if (!ollamaAvailable) {
      return;
    }

    const { chains, answers } = await planWithAnswers(
      'What is the weather in Copenhagen?',
      [
        await createStandInAgent('coding', CODING_DESCRIPTION),
        await createStandInAgent('weather', WEATHER_DESCRIPTION),
      ],
      [WAITING_QUESTION],
    );

    expect(answers).toEqual([]);
    expect(chains.flatMap((chain) => chain.delegations.map((delegation) => delegation.agentId))).toEqual(['weather']);
  }, 120000);
});
