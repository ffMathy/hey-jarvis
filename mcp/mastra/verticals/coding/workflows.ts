import { z } from 'zod';
import { markAsAffectingEntities } from '../../utils/affected-entities.js';
import { createStep, createToolStep, createWorkflow } from '../../utils/workflows/workflow-factory.js';
import { DEFAULT_OWNER, DEFAULT_REPOSITORY, describeRepository } from './repository.js';
import { startCodingSession } from './tools.js';

// Schema for the request the workflow is started with
const requestInputSchema = z.object({
  initialRequest: z.string().describe('The initial feature/implementation request from the user'),
  repository: z.string().optional().describe(`The repository name (defaults to "${DEFAULT_REPOSITORY}", Jarvis's own)`),
  owner: z.string().optional().describe(`The repository owner (defaults to "${DEFAULT_OWNER}")`),
  title: z.string().optional().describe('A short title for the change, used to describe the session'),
});

const workflowStateSchema = z
  .object({
    initialRequest: z.string(),
    title: z.string(),
  })
  .partial();

// Step 1: Prepare the implementing session's task
const prepareCodingSessionData = createStep({
  id: 'prepare-coding-session-data',
  description: 'Prepares the Claude Code session that implements the change',
  stateSchema: workflowStateSchema,
  inputSchema: requestInputSchema,
  outputSchema: z.object({
    owner: z.string().optional(),
    repo: z.string(),
    request: z.string(),
    title: z.string().optional(),
  }),
  execute: async (params) => {
    params.setState({ initialRequest: params.inputData.initialRequest, title: params.inputData.title });

    return {
      owner: params.inputData.owner || DEFAULT_OWNER,
      repo: params.inputData.repository || DEFAULT_REPOSITORY,
      request: params.inputData.initialRequest,
      title: params.inputData.title,
    };
  },
});

// Step 2: Start the Claude Code session that implements the change
const startCodingSessionTool = createToolStep({
  id: 'start-coding-session-tool',
  description: 'Starts a Claude Code session that studies the codebase and implements the change',
  stateSchema: workflowStateSchema,
  tool: startCodingSession,
});

// Schema for coding session tool output - validated at runtime since .then() chain passes unknown
const codingSessionResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  session_id: z.string().optional(),
  status: z.string().optional(),
});

// Step 3: Format final workflow output
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
  }),
  execute: async (params) => {
    const input = codingSessionResultSchema.parse(params.inputData);
    const { title, initialRequest } = params.state;

    if (!input.success) {
      return { success: false, message: `The Claude Code session did not start: ${input.message}`, title };
    }

    return {
      success: true,
      message: `Started a Claude Code session on "${title ?? initialRequest}". It studies the codebase, asks the user whatever only he can decide, and implements the change. The user is notified automatically when it is done, with its pull request — tell him so rather than offering it, since there is nothing for him to accept. ${input.message}`,
      title,
      sessionId: input.session_id,
    };
  },
});

/**
 * Workflow that takes a change from a spoken request to a Claude Code session implementing it
 *
 * The session is started straight away and does the rest itself: it reads the codebase with the
 * request in hand, decides everything the code settles, and implements the change. Only a choice
 * that is the user's to make stops it, and then — or at any later point in the work — it asks,
 * and the watcher puts the question to him on a call or on the house speakers and resumes the
 * session with his answer (see `session-questions.ts`). A request the codebase settles is never
 * held up by questions at all.
 *
 * No issue is filed: the session is the record of the work, and the pull request opened for its
 * branch — by the server, once the session is done, since the session itself cannot push — is
 * where the work is reviewed. The session's events are watched from the moment it starts and
 * republished as Synapse state changes, so its progress reaches the notification system without
 * the workflow having to stay alive for the duration of the implementation.
 */
export const implementFeatureWorkflow = createWorkflow({
  id: 'implementFeatureWorkflow',
  stateSchema: workflowStateSchema,
  inputSchema: requestInputSchema,
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    title: z.string().optional(),
    sessionId: z.string().optional(),
  }),
})
  .then(prepareCodingSessionData)
  .then(startCodingSessionTool)
  .then(formatFinalOutput)
  .commit();

/** What the coding agent hands the workflow when it calls it as a tool. */
const implementFeatureArgumentsSchema = z.object({
  inputData: z.object({ owner: z.string().optional(), repository: z.string().optional() }),
});

/** What the coding agent is handed back when the workflow ran and its session started. */
const implementationStartedSchema = z.object({ result: z.object({ success: z.literal(true) }) });

// The coding agent starts an implementation by calling this workflow as a tool, so the repository
// it names is read off that call -- the session inside it is started by a workflow step, whose result
// never reaches the agent's stream. Only a session that started counts, as for `startCodingSession`
// itself: a workflow that ran but reports the session did not start never touched the repository.
markAsAffectingEntities(implementFeatureWorkflow, (toolArguments, toolResult) => {
  if (!implementationStartedSchema.safeParse(toolResult).success) {
    return [];
  }
  const { owner, repository } = implementFeatureArgumentsSchema.parse(toolArguments).inputData;
  return [describeRepository(owner, repository)];
});
