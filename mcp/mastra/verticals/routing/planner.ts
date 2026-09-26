import type { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { createAgent, getModel } from '../../utils/index.js';
import { getPublicAgents } from '..';
import type { PlannedChain } from './plan.js';
import type { OpenQuestion } from './questions.js';
import { chainsFromTasks } from './task-chains.js';

/**
 * The agent that turns a request into a plan.
 *
 * It replaces a supervisor that delegated inside its own loop. The routing decision is the
 * same one -- which agents, in what order, each asked what -- but it is now written down
 * before anything runs, which is what lets the request be a workflow Studio can draw, and
 * what lets a poll name the work that is still outstanding rather than guess at it.
 *
 * The planner never runs the work and never sees an answer, so nothing here should try to
 * reason about results. It reads a request and emits chains.
 */

const PLANNER_AGENT_ID = 'routing-planner';

/**
 * The model the planner runs on.
 *
 * Flash-Lite rather than the Flash every other agent uses, because the planner is the one call
 * every request waits on before any work starts, and what it does -- pick agents from a list and
 * write each a prompt -- is classification rather than reasoning. Flash-Lite also thinks at
 * `minimal` by default, where Flash thinks at `medium`, so no thinking override is set here: the
 * default is already the fastest level, and naming one risks a level a later model rejects.
 *
 * If plans get worse, this is the line to revert. The routing LLM eval
 * (`workflows.llm-eval.integration.spec.ts`) is what judges them, and it only runs by hand.
 */
const PLANNER_MODEL = 'gemini-flash-lite-latest';

export { PLANNER_AGENT_ID };

/**
 * What the planner emits.
 *
 * A flat list with a dependency named per task, rather than the chains this used to ask for.
 * Chains made sequencing a structural decision -- which bucket does this go in -- and that is
 * the decision the planner got wrong, silently and in the direction that costs a wrong answer:
 * it would write every task as its own chain and a task that needed another's result would
 * run beside it and invent one. Naming the task you are waiting on is a local judgement about
 * a single prompt, and it is the one the planner is actually able to make. The chains are
 * derived from it in `task-chains.ts`, where nothing can place a dependent in parallel with
 * what it depends on.
 *
 * `needs` is required and empty-when-absent rather than optional, because a field the model
 * may omit is a field it will omit. `answers` is required and empty-when-absent for the same
 * reason.
 *
 * `answers` is how a reply to an earlier question finds its way back. The question was put to
 * the user by Jarvis, so the reply arrives as an ordinary request -- "push, please" -- and the
 * planner, which reads every request anyway and is shown the questions still open, is the one
 * place that can tell an answer from a new errand without Jarvis having to label it.
 */
const planSchema = z.object({
  tasks: z
    .array(
      z.object({
        id: z
          .string()
          .describe('A short name for this task, unique within the plan, used only so other tasks can refer to it'),
        agentId: z.string().describe('Exactly one of the agent ids listed in the instructions'),
        prompt: z
          .string()
          .describe('A self-contained instruction for that agent; it cannot see the request or the plan'),
        needs: z
          .string()
          .describe(
            'The id of the task whose answer this one cannot be carried out without, or an empty string if there is none',
          ),
      }),
    )
    .describe('Tasks run at the same time as each other, except where one names another in `needs`'),
  answers: z
    .array(
      z.object({
        questionId: z.string().describe('The id of the waiting question this request answers'),
        answer: z.string().describe("The user's answer to it, in their own words"),
      }),
    )
    .describe('Answers this request gives to the questions listed as waiting, if any; empty otherwise'),
});

export { planSchema };

/** How the planner is told what it may delegate to. */
function agentCatalogue(agents: Agent[]): string {
  return agents.map((agent) => `## ${agent.id}\n${agent.getDescription() || 'No description given.'}`).join('\n\n');
}

/**
 * The planner's instructions.
 *
 * Exported so the LLM evaluation can judge the real thing rather than a paraphrase of it.
 */
export function plannerInstructions(agents: Agent[]): string {
  return `You are the router for the Hey Jarvis assistant. A request arrives that needs work from the specialized agents below, and your job is to write the plan that gets all of it done.

You do not answer anything yourself and you never see a result. Everything the user is asking about — the weather, the calendar, the house, the shopping list, recipes, email, the commute — is known only to these agents. A plan that leaves an agent out is a question that never gets asked.

# The plan
A plan is a list of tasks. Every task names one agent and the prompt it is given. All of them run at the same time, except where one task says it needs another.

\`needs\` is how you say that. Put in it the id of the task whose **answer** this one cannot be carried out without, and this task will wait for it and be handed that answer along with its own prompt. Leave it as an empty string when there is nothing to wait for.

Decide it one task at a time, by asking: **could the agent carry this prompt out knowing only what I wrote in it?** If doing so would mean inventing a value that another task is going off to find — the location, the departure time, the recipe — then it needs that task, and the plan is wrong without it. A task that invents the value instead answers the wrong question, and the user is told something untrue rather than told nothing.

So:
- Independent parts of the request leave \`needs\` empty, so they run at once
- A part that cannot be done until another has answered names that other part — the location before the weather lookup, the work calendar before the traffic check, the recipe before the reminder that lists its ingredients
- Never make independent work wait; that only makes the user wait longer
- A task may name only one other, and it must be one that is in this plan

Here is the shape, on a request asking for the weather where the user is, what is on their
calendar, a lasagna recipe, and a reminder holding that recipe's ingredients:

\`\`\`json
{"tasks": [
  {"id": "location", "agentId": "maps", "prompt": "Where is the user right now?", "needs": ""},
  {"id": "weather", "agentId": "weather", "prompt": "Give the current conditions there.", "needs": "location"},
  {"id": "calendar", "agentId": "calendar", "prompt": "What is on the calendar today?", "needs": ""},
  {"id": "recipe", "agentId": "cooking", "prompt": "Find a lasagna recipe and list its ingredients.", "needs": ""},
  {"id": "reminder", "agentId": "todoList", "prompt": "Add a to-do for this evening listing those ingredients.", "needs": "recipe"}
]}
\`\`\`

Two edges, and both are there because the prompt alone is not enough: "the current conditions
there" means nothing until the location comes back, and "those ingredients" means nothing until
the recipe does. The calendar needs nothing, so it waits for nothing. Note that \`needs\` holds the
**id** of the other task, never its \`agentId\`.

# Writing a task
- \`id\` must be short, lower-case and unique within the plan — \`recipe\`, \`weather\`, \`commute\`. It is never shown to anyone; it exists so another task can name it
- \`agentId\` must be exactly one of the ids below. Never invent one, and never delegate work an agent's description does not cover
- \`prompt\` must be self-contained. The agent cannot see the user's request, this plan, or any other agent's answer, so everything it needs must be in the prompt you write
- For a task with \`needs\`, write the prompt as if that answer is already attached — it is. Say what to do with it rather than restating it, and never write out a guess at what it will say

# Answers to waiting questions
Sometimes an agent working on an earlier request stopped to ask the user something, and those questions are listed after the request. The user was asked out loud, so the answer arrives as a request like any other — "push, please" in reply to "email, or a push notification?".

- If the request answers one of the listed questions, put it in \`answers\` with that question's id and the answer in the user's own words, and write no task for it: the answer goes straight back to the agent that asked
- A request can answer a question and ask for something else at the same time; plan the something else as usual
- If the request answers none of them, or none are listed, leave \`answers\` empty. Never answer a question on the user's behalf, and never treat a new request as an answer just because a question is waiting

# Critical rules
- If no agent can handle part of the request, leave it out rather than misassigning it
- Do not invent work the user did not ask for, and do not look up a value the user already gave you
- Never ask clarifying questions — make best-guess assumptions and plan anyway
- If nothing in the request can be handled by any agent, return no tasks at all

# The agents
${agentCatalogue(agents)}`;
}

/**
 * The ids the planner is allowed to name, remembered from the catalogue it was built with.
 *
 * Held rather than re-derived because `getPublicAgents()` constructs a fresh agent per call
 * -- ten of them, each with its own tools and memory -- and a routing request would otherwise
 * pay for that twice: once to build the planner and once to check what it wrote.
 */
let routableAgentIds: ReadonlySet<string> | undefined;

/** Which agents a plan may delegate to. */
export async function getRoutableAgentIds(): Promise<ReadonlySet<string>> {
  if (!routableAgentIds) {
    routableAgentIds = new Set((await getPublicAgents()).map((agent) => agent.id));
  }
  return routableAgentIds;
}

/**
 * Builds the planner over the agents it is allowed to route to.
 *
 * The catalogue is baked into the instructions rather than looked up per request: the agents
 * are fixed at boot, and the planner is on the latency-critical path.
 */
export async function getRoutingPlannerAgent(): Promise<Agent> {
  const routableAgents = await getPublicAgents();
  routableAgentIds = new Set(routableAgents.map((agent) => agent.id));

  return createAgent({
    id: PLANNER_AGENT_ID,
    name: 'RoutingPlanner',
    description: 'Turns a user request into a plan of delegations for the specialized agents.',
    instructions: plannerInstructions(routableAgents),
    model: getModel(PLANNER_MODEL),
    // Planning one request has nothing to recall from the last one, and memory here would
    // buy an embedding round trip on the one path that cannot afford any. The questions still
    // waiting on the user are the one thing it does need from earlier requests, and those are
    // handed to it in the prompt (see `plannerPrompt`).
    memory: undefined,
  });
}

/** An answer the planner found in a request, to a question that was waiting for one. */
export interface PlannedAnswer {
  questionId: string;
  answer: string;
}

/**
 * What the planner is given: the request, and the questions still waiting on the user.
 *
 * With nothing waiting it is the request alone, exactly as it always was, so the common case is
 * planned from the same input as before questions existed.
 */
export function plannerPrompt(userQuery: string, openQuestions: OpenQuestion[]): string {
  if (openQuestions.length === 0) {
    return userQuery;
  }

  const waiting = openQuestions
    .map((question) => `- id "${question.id}", asked by ${question.agentId}: ${question.question}`)
    .join('\n');

  return `The request:\n${userQuery}\n\nQuestions waiting for the user's answer:\n${waiting}`;
}

/** Asks the planner for a plan: the chains it runs as, and any answers the request gave. */
export async function planDelegations(
  planner: Agent,
  userQuery: string,
  openQuestions: OpenQuestion[] = [],
): Promise<{ chains: PlannedChain[]; answers: PlannedAnswer[] }> {
  const response = await planner.generate(plannerPrompt(userQuery, openQuestions), {
    structuredOutput: { schema: planSchema },
    toolChoice: 'none',
  });

  const plan = response.object;
  if (!plan) {
    throw new Error('The routing planner did not return a plan');
  }

  // Only answers to questions that were actually shown, and that say something. A made-up id
  // would resume nothing, and an empty answer would resume the work with nothing to go on.
  const openIds = new Set(openQuestions.map((question) => question.id));
  const answers = plan.answers.filter((answer) => openIds.has(answer.questionId) && answer.answer.trim().length > 0);

  return { chains: chainsFromTasks(plan.tasks, await getRoutableAgentIds()), answers };
}
