import { z } from 'zod';
import { markAsSlow } from '../../utils/slow-tasks.js';
import { createStep, createToolStep, createWorkflow } from '../../utils/workflows/workflow-factory.js';
import { DEFAULT_OWNER, DEFAULT_REPOSITORY } from './repository.js';
import { runCodingTask, startCodingSession } from './tools.js';

// Schema for the request the workflow is started with
const requestInputSchema = z.object({
  initialRequest: z.string().describe('The initial feature/implementation request from the user'),
  repository: z.string().optional().describe(`The repository name (defaults to "${DEFAULT_REPOSITORY}", Jarvis's own)`),
  owner: z.string().optional().describe(`The repository owner (defaults to "${DEFAULT_OWNER}")`),
});

/**
 * What the analysing session hands back: what it learned, and what it could not.
 *
 * Everything the codebase can answer is answered in `findings`, so `questions` is only what is
 * left — the choices that are the user's to make. Empty is a perfectly good answer: a request
 * the codebase settles goes straight to implementation.
 */
export const codebaseAnalysisSchema = z.object({
  title: z.string().describe('A short title for the change'),
  findings: z
    .string()
    .describe('What the codebase says about the request: where it goes, what it builds on, how it should work'),
  questions: z.array(z.string()).describe('What only the user can answer, one short spoken question each'),
});

export type CodebaseAnalysis = z.infer<typeof codebaseAnalysisSchema>;

/** Most questions the analysis may ask. Each one is a round trip by voice. */
const MAXIMUM_QUESTIONS = 5;

const workflowStateSchema = z
  .object({
    initialRequest: z.string(),
    repository: z.string(),
    owner: z.string(),
    analysis: codebaseAnalysisSchema,
    // What was asked and what the user said, pair by pair, in the user's own words. The
    // session implementing the change is handed this, not a paraphrase of it.
    interview: z.array(z.object({ question: z.string(), answer: z.string() })),
  })
  .partial();

/**
 * The instructions for the session that reads the codebase before anyone is asked anything.
 *
 * Asking before looking is what made the old interview slow and generic: a model that had never
 * seen the code asked where things should go and what they should build on, and sir had to know.
 * The session looks first, so the questions that reach him are only the ones the code cannot
 * answer — and they reach him by voice, which is why they are written to be heard.
 */
export function buildCodebaseAnalysisTask(request: string, repository: string, isJarvisOwn: boolean): string {
  return `You are preparing a change to the ${repository} repository${isJarvisOwn ? " — Jarvis's own codebase" : ''}. The user asked for this:

"${request}"

Clone the repository and study the parts of it this request touches: where the change belongs, what it builds on, the conventions it has to follow (AGENTS.md and CLAUDE.md included), and how it should behave. Do not change anything, create a branch or open a pull request — this session only reads.

Then decide what is still unclear. Anything the code, its documentation or its conventions settle is not a question: decide it, and write it into your findings. What is left are the choices only the user can make — what he wants, not how the codebase works. Ask at most ${MAXIMUM_QUESTIONS}, and none at all if the request is clear enough to build.

The questions are read aloud to him by a voice assistant, and he answers out loud. So each one is a single short sentence about one thing, in plain spoken language: no markdown, code, file paths or identifiers. Where there are a few sensible options, name them in the question ("by email, or as a push notification?"). The repository is settled, so never ask which one is meant.

End your final message with only this JSON object, and nothing after it:
{
  "title": "a short title for the change",
  "findings": "what you learned: where the change goes, what it builds on, and how it should behave — written for the engineer who will implement it",
  "questions": ["each question for the user"]
}`;
}

/**
 * Reads the analysis out of the session's last message.
 *
 * The session is asked to end on the JSON object alone, but a session is a model and may wrap it
 * in a code fence or say something first, so the object is taken from the last fence if there is
 * one and from the outermost braces otherwise.
 */
export function readCodebaseAnalysis(finalMessage: string): CodebaseAnalysis {
  const fenced = [...finalMessage.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].pop()?.[1];
  const candidate = fenced ?? finalMessage.slice(finalMessage.indexOf('{'), finalMessage.lastIndexOf('}') + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error(`The codebase analysis did not end with its JSON summary: ${finalMessage.slice(-200)}`);
  }

  const analysis = codebaseAnalysisSchema.parse(parsed);
  return {
    ...analysis,
    questions: analysis.questions
      .map((question) => question.trim())
      .filter((question) => question.length > 0)
      .slice(0, MAXIMUM_QUESTIONS),
  };
}

// Step 1: Write the task for the session that reads the codebase
const prepareCodebaseAnalysis = createStep({
  id: 'prepare-codebase-analysis',
  description: 'Writes the task for the Claude cloud session that analyses the codebase before anything is asked',
  stateSchema: workflowStateSchema,
  inputSchema: requestInputSchema,
  outputSchema: z.object({ task: z.string() }),
  execute: async (params) => {
    const owner = params.inputData.owner || DEFAULT_OWNER;
    const repository = params.inputData.repository || DEFAULT_REPOSITORY;

    params.setState({
      initialRequest: params.inputData.initialRequest,
      repository,
      owner,
      interview: [],
    });

    return {
      task: buildCodebaseAnalysisTask(
        params.inputData.initialRequest,
        `${owner}/${repository}`,
        owner === DEFAULT_OWNER && repository === DEFAULT_REPOSITORY,
      ),
    };
  },
});

// Step 2: Have a Claude cloud session read the codebase and write the questions
const analyzeCodebaseTool = createToolStep({
  id: 'analyze-codebase-tool',
  description: 'Runs a Claude cloud session that reads the codebase and works out what only the user can answer',
  stateSchema: workflowStateSchema,
  tool: runCodingTask,
});

// Schema for the analysis tool's output - validated at runtime since .then() chain passes unknown
const codingTaskResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  final_message: z.string().optional(),
});

// Step 3: Keep what the session found
const storeCodebaseAnalysis = createStep({
  id: 'store-codebase-analysis',
  description: 'Reads the findings and questions out of the analysing session’s last message',
  stateSchema: workflowStateSchema,
  inputSchema: z.unknown(),
  outputSchema: z.object({}),
  execute: async (params) => {
    const result = codingTaskResultSchema.parse(params.inputData);
    if (!result.success || !result.final_message) {
      throw new Error(`The codebase could not be analysed: ${result.message}`);
    }

    params.setState({ ...params.state, analysis: readCodebaseAnalysis(result.final_message) });
    return {};
  },
});

// Step 4: Put the analysis's questions to the user, one suspension each
const askAnalysisQuestions = createStep({
  id: 'ask-analysis-questions',
  description: 'Asks the user the questions the codebase analysis could not answer, one at a time',
  stateSchema: workflowStateSchema,
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  resumeSchema: z.object({
    userAnswer: z.string().describe("The user's answer to the question"),
  }),
  suspendSchema: z.object({
    question: z.string().describe('The question being asked to the user'),
    context: z.string().describe("Context about what we're trying to gather"),
  }),
  execute: async (params) => {
    const state = params.state;
    const questions = state.analysis?.questions ?? [];
    let interview = state.interview ?? [];

    // The answer is to the question this step last suspended with, which is the first one
    // not yet answered.
    if (params.resumeData?.userAnswer) {
      interview = [...interview, { question: questions[interview.length] ?? '', answer: params.resumeData.userAnswer }];
      params.setState({ ...state, interview });
    }

    const nextQuestion = questions[interview.length];
    if (nextQuestion) {
      // When the coding agent runs this as a tool, the suspension travels up through the agent
      // to the routing plan, which hands the question to Jarvis to ask aloud and resumes this
      // run with the answer -- see `verticals/routing/controller.ts`.
      return await params.suspend({
        question: nextQuestion,
        context: `Preparing the change for: ${state.initialRequest}`,
      });
    }

    return {};
  },
});

/** Everything the implementing session is told beyond the request itself. */
function buildImplementationInstructions(
  analysis: CodebaseAnalysis | undefined,
  interview: { question: string; answer: string }[],
): string | undefined {
  const sections = [
    analysis?.findings ? `What an earlier session found in the codebase:\n${analysis.findings}` : undefined,
    interview.length > 0
      ? `The user's answers to questions about the change:\n${interview
          .map(({ question, answer }) => `- Q: ${question}\n  A: ${answer}`)
          .join('\n')}`
      : undefined,
  ].filter((section): section is string => typeof section === 'string');

  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

// Step 5: Prepare the implementing session's task
const prepareCodingSessionData = createStep({
  id: 'prepare-coding-session-data',
  description: 'Prepares the Claude cloud session that implements the change',
  stateSchema: workflowStateSchema,
  inputSchema: z.object({}),
  outputSchema: z.object({
    owner: z.string().optional(),
    repo: z.string(),
    request: z.string(),
    title: z.string().optional(),
    instructions: z.string().optional(),
  }),
  execute: async (params) => {
    const state = params.state;

    if (!state.repository || !state.initialRequest) {
      throw new Error('Missing the repository or the request in workflow state');
    }

    return {
      owner: state.owner,
      repo: state.repository,
      request: state.initialRequest,
      title: state.analysis?.title,
      instructions: buildImplementationInstructions(state.analysis, state.interview ?? []),
    };
  },
});

// Step 6: Start the Claude cloud session that implements the change
const startCodingSessionTool = createToolStep({
  id: 'start-coding-session-tool',
  description: 'Starts a Claude cloud session that implements the change',
  stateSchema: workflowStateSchema,
  tool: startCodingSession,
});

// Schema for coding session tool output - validated at runtime since .then() chain passes unknown
const codingSessionResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  session_id: z.string().optional(),
  session_url: z.string().optional(),
  status: z.string().optional(),
});

// Step 7: Format final workflow output
const formatFinalOutput = createStep({
  id: 'format-final-output',
  description: 'Formats the final workflow output with success message',
  stateSchema: workflowStateSchema,
  inputSchema: z.unknown(),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    title: z.string().optional(),
    sessionId: z.string().optional(),
    sessionUrl: z.string().optional(),
  }),
  execute: async (params) => {
    const input = codingSessionResultSchema.parse(params.inputData);
    const title = params.state.analysis?.title;

    if (!input.success) {
      return { success: false, message: `The Claude cloud session did not start: ${input.message}`, title };
    }

    return {
      success: true,
      message: `Started a Claude cloud session on "${title ?? params.state.initialRequest}". ${input.message}`,
      title,
      sessionId: input.session_id,
      sessionUrl: input.session_url,
    };
  },
});

/**
 * Workflow that takes a change from a spoken request to a Claude cloud session implementing it
 *
 * 1. A Claude cloud session reads the codebase with the request in hand, and writes down what it
 *    found and the questions only the user can answer (3 sub-steps)
 * 2. Those questions are put to the user, suspending on each one until it is answered
 * 3. A Claude cloud session is started on the change, handed the request, the findings and
 *    every answer in the user's own words (2 sub-steps)
 *
 * No issue is filed: the session is the record of the work, and the pull request it opens is
 * where the work is reviewed. The session's events are watched from the moment it starts and
 * republished as Synapse state changes, so its progress reaches the notification system without
 * the workflow having to stay alive for the duration of the implementation.
 *
 * Marked slow, because the analysis alone takes minutes: routing sees the coding agent start it
 * and has Jarvis offer to notify the user rather than hold the line (see `utils/slow-tasks.ts`).
 */
export const implementFeatureWorkflow = markAsSlow(
  createWorkflow({
    id: 'implementFeatureWorkflow',
    stateSchema: workflowStateSchema,
    inputSchema: requestInputSchema,
    outputSchema: z.object({
      success: z.boolean(),
      message: z.string(),
      title: z.string().optional(),
      sessionId: z.string().optional(),
      sessionUrl: z.string().optional(),
    }),
  })
    .then(prepareCodebaseAnalysis)
    .then(analyzeCodebaseTool)
    .then(storeCodebaseAnalysis)
    // Not a loop: the step asks, suspends, and is resumed with the answer as many times as there
    // are questions, and only returns once every one is answered.
    .then(askAnalysisQuestions)
    .then(prepareCodingSessionData)
    .then(startCodingSessionTool)
    .then(formatFinalOutput)
    .commit(),
);
