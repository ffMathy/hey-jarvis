import type { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { createAgent, getModel } from '../../utils/index.js';
import { logger } from '../../utils/logger.js';
import { getPublicAgents } from '..';
import { getHomeDomains, getHomeServices } from '../internet-of-things/home-commands.js';
import { findPhoto, howLongAgo, type WaitingPhoto } from '../vision/photos.js';
import {
  classifyRequest,
  type FastRoute,
  getRoutingClassifier,
  type RelationToRunningRequest,
  type RequestClassification,
  type RoutableAgentSummary,
} from './classifier.js';
import type { DirectAnswer } from './direct-answers.js';
import type { PlannedChain } from './plan.js';
import type { OpenQuestion } from './questions.js';
import { RESPONSE_STYLE_DESCRIPTIONS, RESPONSE_STYLES, type ResponseStyle } from './response-styles.js';
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

export { PLANNER_AGENT_ID, RESPONSE_STYLES, type ResponseStyle };

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
 *
 * `dismissedPhotoIds` is the one reply about a photo that is not work: "nothing, never mind" — about
 * a waiting photo, or about the one Jarvis has just described to him and asked about. Without it such
 * a reply planned no task and no answer, and the empty plan was reported to sir as a request no agent
 * could handle. Required and empty-when-absent, like `answers`.
 *
 * `photosToAskAbout` is a photo sir sent with nothing said. The vision agent looks at it like any
 * other, and then Jarvis has to do what every other finished request forbids him — ask sir something
 * — so the plan says which photos he is to ask about, and the closing report turns each into a
 * question of this request's own (see `buildClosingReport` in `workflows.ts`). Required and
 * empty-when-absent, like the others.
 *
 * `awaitsPhoto` is a photo he says is on its way — "I'll send you a receipt" — with nothing to look at
 * yet. The voice agent is told to route nothing until it arrives, but a request that slipped through
 * planned nothing for it, and the empty plan was reported to sir as a request no agent could handle,
 * closing on the hang-up just as he went quiet to take the shot. Set, the request finishes as done,
 * and its closing report has Jarvis tell him to go ahead and then wait for the photo (see
 * `buildClosingReport` in `workflows.ts`). Required, like the rest, since a flag the model may leave
 * out is one it will.
 */
const planSchema = z.object({
  responseStyle: z
    .enum(RESPONSE_STYLES)
    .describe(
      'How the answer should sound: command, lookup, briefing or conversation, as described in the instructions',
    ),
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
  dismissedPhotoIds: z
    .array(z.string())
    .describe(
      'The ids of listed photos the user wants nothing done with — a waiting one, or one the request names that he was just asked about — if any; empty otherwise',
    ),
  photosToAskAbout: z
    .array(z.string())
    .describe('The ids of photos this request shows Jarvis without saying what to do with them; empty otherwise'),
  awaitsPhoto: z
    .boolean()
    .describe('True only when the request says he is about to send or show a photo that has not arrived yet'),
});

export { planSchema };

/** The styles, as the planner's instructions list them. */
function responseStyleList(): string {
  return RESPONSE_STYLES.map((style) => `- \`${style}\` — ${RESPONSE_STYLE_DESCRIPTIONS[style]}`).join('\n');
}

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
Sometimes work started earlier — an agent on an earlier request, or a coding session implementing a change — stopped to ask the user something, and those questions are listed after the request. The user was asked out loud, on a call, on the house speakers or in conversation, so the answer arrives as a request like any other — "push, please" in reply to "email, or a push notification?". Jarvis may quote the question it answers ("Answer to 'email, or a push notification?': push, please"); the answer is still only what the user said.

- If the request answers one of the listed questions, put it in \`answers\` with that question's id and the answer in the user's own words, and write no task for it: the answer goes straight back to the agent that asked
- A request can answer a question and ask for something else at the same time; plan the something else as usual
- If the request answers none of them, or none are listed, leave \`answers\` empty. Never answer a question on the user's behalf, and never treat a new request as an answer just because a question is waiting

# Photos
The user can send Jarvis a photo with the camera button on his phone. Photos he has sent that nobody has looked at yet are listed after the request, each by its id and how long ago he sent it — including one he has only just sent. A photo the request names by its tag that has been looked at or dismissed already is listed too, under a heading of its own: most often it is the one Jarvis has just described to him and asked about. Jarvis may have asked him what he would like done with one, so the request can be his reply ("Answer to 'what would you like done with the photo?': add everything on it to the shopping list").

- If the request says what to do with one of them, or asks about a photo he sent, plan it as ordinary tasks: the \`vision\` agent looks at the photo, and its prompt names the photo the way a request does — "(photo photo3)" — beside what to find out from it. Any task that acts on what the photo shows needs that task. Leave \`photosToAskAbout\` empty: he has said what he wants
- If the request is a photo he sent without saying what he wants — "He sent a photo without saying what he wants: look at it and say what it shows (photo photo3)" — plan one \`vision\` task that looks at it and says what it shows and what could be done with it: the items and amounts on it, dates, names, numbers or any text worth acting on. Put its id in \`photosToAskAbout\`, and Jarvis will ask him what he would like done with it once he has said what it shows. Plan nothing else for it: what to do with it is his to say
- A photo he says he is about to send — "I'll send you a receipt" — has not arrived: plan nothing for it, since there is nothing to look at yet, and nothing for what he wants done with it, which comes back with the photo once it arrives. Set \`awaitsPhoto\`, and Jarvis tells him to go ahead with the camera button and waits for it. Plan anything else the request asks for as usual. Leave \`awaitsPhoto\` false otherwise, and always for a photo that has already arrived
- "The photo", "the picture" or "it" means the one listed when there is one, and the one sent last when there are several
- A photo is never a waiting question: never put one in \`answers\`, even when the request replies to being asked about it
- If he wants nothing done with one — "nothing", "never mind", "I was only testing" — put its id in \`dismissedPhotoIds\` and write no task for it: it stops waiting, and he is not asked about it again. That includes his reply about the photo the request names when he was just asked what to do with it — "Answer to 'what would you like done with it?': nothing (photo photo3)" — under whichever heading it is listed. Only for a photo he said so about; otherwise leave \`dismissedPhotoIds\` empty
- A request about something else leaves them alone: write no task for a photo the request does not mention

# How the answer should sound
Set \`responseStyle\` to how Jarvis should answer once the plan has run. Ask where the value of the request lands:
${responseStyleList()}

When a request mixes kinds, pick the one that needs the most words — a command and a lookup together is a \`lookup\`; anything with a briefing in it is a \`briefing\`. An answer to a waiting question takes the style of the work it resumes. A request that only dismisses photos is a \`command\`, and so is one that only says a photo is on its way; a photo he sent without saying what he wants is a \`lookup\`. With no tasks at all otherwise, use \`conversation\`.

# Critical rules
- If no agent can handle part of the request, leave it out rather than misassigning it
- Do not invent work the user did not ask for, and do not look up a value the user already gave you
- Never ask clarifying questions — make best-guess assumptions and plan anyway
- If nothing in the request can be handled by any agent, return no tasks at all

# The agents
${agentCatalogue(agents)}`;
}

/**
 * The agents the planner is allowed to name, remembered from the catalogue it was built with.
 *
 * Held rather than re-derived because `getPublicAgents()` constructs a fresh agent per call
 * -- one per public agent, each with its own tools and memory -- and a routing request would otherwise
 * pay for that twice: once to build the planner and once to check what it wrote. The routing
 * classifier is shown the same catalogue, so it cannot pick an agent the planner could not.
 */
let routableAgents: RoutableAgentSummary[] | undefined;

function rememberRoutableAgents(agents: Agent[]): RoutableAgentSummary[] {
  routableAgents = agents.map((agent) => ({ id: agent.id, description: agent.getDescription() }));
  return routableAgents;
}

async function getRoutableAgents(): Promise<RoutableAgentSummary[]> {
  return routableAgents ?? rememberRoutableAgents(await getPublicAgents());
}

/** Which agents a plan may delegate to. */
export async function getRoutableAgentIds(): Promise<ReadonlySet<string>> {
  return new Set((await getRoutableAgents()).map((agent) => agent.id));
}

/**
 * Builds the planner over the agents it is allowed to route to.
 *
 * The catalogue is baked into the instructions rather than looked up per request: the agents
 * are fixed at boot, and the planner is on the latency-critical path.
 */
export async function getRoutingPlannerAgent(): Promise<Agent> {
  const agents = await getPublicAgents();
  rememberRoutableAgents(agents);

  return createAgent({
    id: PLANNER_AGENT_ID,
    name: 'RoutingPlanner',
    description: 'Turns a user request into a plan of delegations for the specialized agents.',
    instructions: plannerInstructions(agents),
    model: getModel(PLANNER_MODEL),
    // Planning one request has nothing to recall from the last one, and memory here would
    // buy an embedding round trip on the one path that cannot afford any. The questions still
    // waiting on the user, and the photos nobody has looked at, are the one thing it does need
    // from earlier requests, and those are handed to it in the prompt (see `plannerPrompt`).
    memory: undefined,
  });
}

/** An answer the planner found in a request, to a question that was waiting for one. */
export interface PlannedAnswer {
  questionId: string;
  answer: string;
}

/**
 * What the planner is given: the request, the questions still waiting on the user, the photos he has
 * sent that nobody has looked at yet, and any other photo the request names.
 *
 * With nothing waiting it is the request alone, exactly as it always was, so the common case is
 * planned from the same input as before questions existed.
 *
 * Photos are listed with their age, oldest first, so "the photo" can be read as the one sent last,
 * and each by the id a vision task has to be handed (see `routing/waiting-photos.ts`). A photo the
 * request names that is no longer waiting is listed apart (see `photosTheRequestNames`), so that
 * nothing about one Jarvis has already looked at reads as though nobody had.
 */
export function plannerPrompt(
  userQuery: string,
  openQuestions: OpenQuestion[],
  waitingPhotos: readonly WaitingPhoto[] = [],
  namedPhotos: readonly WaitingPhoto[] = [],
  now = Date.now(),
): string {
  if (openQuestions.length === 0 && waitingPhotos.length === 0 && namedPhotos.length === 0) {
    return userQuery;
  }

  const sections = [`The request:\n${userQuery}`];
  if (openQuestions.length > 0) {
    const waiting = openQuestions
      .map((question) => `- id "${question.id}", asked by ${question.agentId}: ${question.question}`)
      .join('\n');
    sections.push(`Questions waiting for the user's answer:\n${waiting}`);
  }
  if (waitingPhotos.length > 0) {
    sections.push(`Photos the user has sent that nobody has looked at yet:\n${photoList(waitingPhotos, now)}`);
  }
  if (namedPhotos.length > 0) {
    sections.push(
      `Photos the request names, which have been looked at or dismissed already:\n${photoList(namedPhotos, now)}`,
    );
  }

  return sections.join('\n\n');
}

/** Photos as the planner is shown them: by id, and how long ago each was sent. */
function photoList(photos: readonly WaitingPhoto[], now: number): string {
  return photos.map((photo) => `- ${photo.photoId}, sent ${howLongAgo(now - photo.keptAt)}`).join('\n');
}

/** The tag a request names a photo with, such as "(photo photo3)" (see `vision/agents.ts`). */
const NAMES_A_PHOTO = /\(photo \w+\)/i;

/** The same tag, every time a request carries it, with the id it names. */
const PHOTO_TAG = /\(photo (\w+)\)/gi;

/**
 * The photos a request names by their tag that are still kept but no longer waiting, oldest first:
 * looked at — most often by the very look Jarvis has just described to sir and asked him about — or
 * dismissed.
 *
 * Such a photo is not among the waiting ones, yet the request is about it. "Answer to 'what would you
 * like done with it?': nothing (photo photo3)" is the reply to the question a look at photo3 ended
 * on, and with photo3 no longer waiting the planner was shown nothing to dismiss — so the reply that
 * asked for nothing was reported to sir as a request no agent could handle.
 *
 * Only a photo the tag names by its id. An id with no letter or digit in it is no id to the store,
 * which would stand the latest photo in for it (see `findPhoto`), and a photo the request does not
 * name is not one it can be about.
 */
function photosTheRequestNames(userQuery: string, waitingPhotos: readonly WaitingPhoto[]): WaitingPhoto[] {
  const waitingIds = new Set(waitingPhotos.map((photo) => photo.photoId));
  const named = new Map<string, WaitingPhoto>();
  for (const [, taggedId] of userQuery.matchAll(PHOTO_TAG)) {
    const photo = /[a-z0-9]/i.test(taggedId) ? findPhoto(taggedId) : undefined;
    if (photo && !waitingIds.has(photo.photoId)) {
      named.set(photo.photoId, { photoId: photo.photoId, keptAt: photo.keptAt });
    }
  }
  return [...named.values()].sort((earlier, later) => earlier.keptAt - later.keptAt);
}

/** What routing does with a request: the chains it runs as, and any answers the request gave. */
export interface RoutingDecision {
  chains: PlannedChain[];
  answers: PlannedAnswer[];
  responseStyle: ResponseStyle;
  /**
   * How the request is answered without its agent, rather than through `chains`, which are then the
   * fallback should that decline or fail (see `direct-answers.ts`).
   */
  direct?: DirectAnswer;
  /** The request is only about ending the call, so there is nothing to run. */
  endsCall?: boolean;
  /**
   * How the request relates to the one still running in its session, when the classifier is sure.
   * Left out, the new request supersedes the running one, as every request did before.
   */
  relationToRunningRequest?: RelationToRunningRequest;
  /**
   * Photos sir said he wants nothing done with: waiting ones, or ones the request names (see
   * `photosTheRequestNames`). Only the planner decides these.
   */
  dismissedPhotoIds?: string[];
  /**
   * Photos sir sent without saying what he wants, which Jarvis is to ask him about once the vision
   * agent has said what they show. Only the planner decides these.
   */
  photosToAskAbout?: string[];
  /**
   * The request says a photo is on its way that has not arrived, so Jarvis is to tell sir to go ahead
   * with the camera and wait for it, rather than hang up. Only the planner decides this.
   */
  awaitsPhoto?: boolean;
}

/**
 * Asks the planner for a plan: the chains it runs as, any answers the request gave, any photos it
 * said sir wants nothing done with, any it said he sent without saying what for, and whether it says
 * a photo is on its way.
 *
 * A waiting photo is shown to the planner but never answered: sir's reply about one is a request
 * of its own, planned as work on the photo, so an answer naming a photo's id is dropped below with
 * any other id that names no open question. Only a reply that he wants nothing done with it is not
 * work, and that comes back as a dismissal instead — for a waiting photo, or for one the request
 * names that has been looked at already, which is how he answers the question such a look ends on. A
 * photo sent with nothing said is work — the vision agent looks at it — and comes back in
 * `photosToAskAbout` too, so that Jarvis asks what he would like done with it once he has said what
 * it shows.
 */
async function planWithPlanner(
  planner: Agent,
  userQuery: string,
  openQuestions: OpenQuestion[],
  waitingPhotos: readonly WaitingPhoto[],
  namedPhotos: readonly WaitingPhoto[],
  abortSignal: AbortSignal,
): Promise<RoutingDecision> {
  const response = await planner.generate(plannerPrompt(userQuery, openQuestions, waitingPhotos, namedPhotos), {
    structuredOutput: { schema: planSchema },
    toolChoice: 'none',
    abortSignal,
  });

  const plan = response.object;
  if (!plan) {
    throw new Error('The routing planner did not return a plan');
  }

  // Only answers to questions that were actually shown, and that say something. A made-up id
  // would resume nothing, and an empty answer would resume the work with nothing to go on.
  const openIds = new Set(openQuestions.map((question) => question.id));
  const answers = plan.answers.filter((answer) => openIds.has(answer.questionId) && answer.answer.trim().length > 0);

  // Only photos it was shown, for the same reason: a made-up id would dismiss nothing, and would
  // still let an otherwise empty plan pass for one that did something.
  const shownIds = new Set([...waitingPhotos, ...namedPhotos].map((photo) => photo.photoId));
  const dismissedPhotoIds = [...new Set(plan.dismissedPhotoIds)].filter((photoId) => shownIds.has(photoId));
  // Likewise, and never one he has just waved away: a photo he wants nothing done with is not one to
  // ask him about. Only a waiting one, too: a photo looked at already has been described to him.
  const waitingIds = new Set(waitingPhotos.map((photo) => photo.photoId));
  const photosToAskAbout = [...new Set(plan.photosToAskAbout)].filter(
    (photoId) => waitingIds.has(photoId) && !dismissedPhotoIds.includes(photoId),
  );

  return {
    chains: chainsFromTasks(plan.tasks, await getRoutableAgentIds()),
    answers,
    dismissedPhotoIds,
    photosToAskAbout,
    ...(plan.awaitsPhoto && { awaitsPhoto: true }),
    responseStyle: plan.responseStyle,
  };
}

/**
 * The plan for a request one agent takes whole: that agent, asked in the user's own words.
 *
 * Built through `chainsFromTasks` like any planned request, so a fast route runs exactly as a
 * one-task plan would.
 */
export async function planFromFastRoute(route: FastRoute, userQuery: string): Promise<RoutingDecision> {
  return {
    chains: chainsFromTasks(
      [{ id: route.agentId, agentId: route.agentId, prompt: userQuery, needs: '' }],
      await getRoutableAgentIds(),
    ),
    answers: [],
    responseStyle: route.responseStyle,
    ...(route.direct && { direct: route.direct }),
  };
}

/**
 * The decision the classifier settles a request with on its own, or nothing when the planner should.
 *
 * An answer to a waiting question is the user's own words, which is what the planner is told to
 * copy anyway, and a goodbye has nothing to run at all.
 */
export async function decisionFromClassification(
  classification: RequestClassification,
  userQuery: string,
): Promise<RoutingDecision | undefined> {
  const { responseStyle, relationToRunningRequest } = classification;
  const relation = relationToRunningRequest && { relationToRunningRequest };

  if (classification.endsCall) {
    return { chains: [], answers: [], responseStyle, endsCall: true, ...relation };
  }
  if (classification.answeredQuestionId) {
    return {
      chains: [],
      answers: [{ questionId: classification.answeredQuestionId, answer: userQuery }],
      responseStyle,
      ...relation,
    };
  }
  if (classification.relationToRunningRequest === 'cancels') {
    return { chains: [], answers: [], responseStyle: 'command', ...relation };
  }
  if (classification.fastRoute) {
    return { ...(await planFromFastRoute(classification.fastRoute, userQuery)), ...relation };
  }
  return undefined;
}

/**
 * Decides what a request needs: the chains it runs as, and any answers it gave.
 *
 * The planner and the routing classifier (see `classifier.ts`) are asked at the same time. If the
 * classifier settles the request on its own -- one agent takes it whole, it only answers a waiting
 * question, it is only a goodbye, or it only cancels the running request -- that is the decision
 * and the planner is cancelled. Otherwise the planner's plan is used, and the request waited no
 * longer than it would have without a classifier at all. A classifier that fails is logged and
 * ignored, for the same reason. Without a TypeSafe key there is no classifier, and this is the
 * planner alone.
 *
 * With a request still running, how the new one relates to it is wanted even when the planner
 * answers first, so the classifier is then waited for -- it is the faster of the two, so that
 * seldom costs anything.
 *
 * **Photos are the planner's alone.** The classifier is never shown them, so while one is waiting,
 * or when the request names one, a fast route would hand an agent sir's words with no photo to go
 * with them, and an answer to a waiting question could be the reply that says what a photo is for.
 * Then only a goodbye is the classifier's to settle: it runs nothing, and a waiting photo stays
 * waiting for the next conversation.
 *
 * A photo the request names that is no longer waiting is looked up here, before either starts, so the
 * planner is shown it too (see `photosTheRequestNames`).
 */
export async function planDelegations(
  planner: Agent,
  userQuery: string,
  openQuestions: OpenQuestion[] = [],
  waitingPhotos: readonly WaitingPhoto[] = [],
  runningRequest: string | undefined = undefined,
  classifier = getRoutingClassifier(),
): Promise<RoutingDecision> {
  const abortPlanner = new AbortController();
  const namedPhotos = photosTheRequestNames(userQuery, waitingPhotos);
  if (!classifier) {
    return planWithPlanner(planner, userQuery, openQuestions, waitingPhotos, namedPhotos, abortPlanner.signal);
  }
  // A photo he says is on its way — "I'll send you a receipt, add it to the list" — does not count:
  // it names no photo, and usually none is waiting, so the classifier may route the rest of such a
  // request on its own. That is left as it is on purpose. The voice agent is told to route nothing
  // until the photo arrives (`elevenlabs/src/assets/agent-prompt.md`), so such a request reaches here
  // only when it slipped through, and what the planner makes of one it is left (`awaitsPhoto`) is the
  // backstop, not the path.
  const photosInPlay = waitingPhotos.length > 0 || NAMES_A_PHOTO.test(userQuery);

  // Before either starts, so nothing is awaited between starting the planner and handling it.
  // Services and domains are cached, and empty when Home Assistant is slow, so this never waits long.
  const [agents, services, domains] = await Promise.all([getRoutableAgents(), getHomeServices(), getHomeDomains()]);
  const planned = planWithPlanner(planner, userQuery, openQuestions, waitingPhotos, namedPhotos, abortPlanner.signal);
  const abortClassifier = new AbortController();
  const classified = classifyRequest(
    classifier,
    userQuery,
    { agents, openQuestions, services, domains, runningRequest },
    abortClassifier.signal,
  ).catch((error: unknown) => {
    if (!abortClassifier.signal.aborted) {
      logger.warn('Routing classifier failed; using the planner', { error });
    }
    return undefined;
  });

  try {
    const decision = await preferFastPlan(
      planned,
      classified.then((classification) =>
        classification && (!photosInPlay || classification.endsCall)
          ? decisionFromClassification(classification, userQuery)
          : undefined,
      ),
    );
    if (runningRequest === undefined || decision.relationToRunningRequest) {
      return decision;
    }

    const relationToRunningRequest = (await classified)?.relationToRunningRequest;
    return relationToRunningRequest ? { ...decision, relationToRunningRequest } : decision;
  } finally {
    // Whichever lost is working for nothing. Aborting the winner is a no-op.
    abortPlanner.abort();
    abortClassifier.abort();
  }
}

/**
 * The fast plan if there is one, and the planner's otherwise -- whichever can be known first.
 *
 * A fast plan wins as soon as it exists, even over a planner that has already failed. A planner
 * that answers first wins outright, since there is nothing left to be faster than. A planner
 * failure is final only once the classifier has declined too.
 */
export async function preferFastPlan(
  planned: Promise<RoutingDecision>,
  fastPlan: Promise<RoutingDecision | undefined>,
): Promise<RoutingDecision> {
  const fastPlanOrPlanned = fastPlan.then((plan) => plan ?? planned);
  const plannedUnlessFailed = planned.catch(() => fastPlanOrPlanned);
  return Promise.race([plannedUnlessFailed, fastPlanOrPlanned]);
}
