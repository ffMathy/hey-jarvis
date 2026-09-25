import type { CoreMessageV4 } from '@mastra/core/agent/message-list';
import { z } from 'zod';
import { createStep, createToolStep, createWorkflow } from '../../utils/workflows/workflow-factory.js';
import { DEFAULT_OWNER, DEFAULT_REPOSITORY } from './repository.js';
import { createGitHubIssue, startCodingSession } from './tools.js';

// Schema for requirements gathering input
const requirementsInputSchema = z.object({
  initialRequest: z.string().describe('The initial feature/implementation request from the user'),
  repository: z.string().optional().describe(`The repository name (defaults to "${DEFAULT_REPOSITORY}", Jarvis's own)`),
  owner: z.string().optional().describe(`The repository owner (defaults to "${DEFAULT_OWNER}")`),
});

// Schema for gathered requirements
const gatheredRequirementsSchema = z.object({
  title: z.string().optional().describe('Clear, concise feature title'),
  requirements: z.array(z.string()).optional().describe('List of specific requirements gathered from the user'),
  acceptanceCriteria: z.array(z.string()).optional().describe('List of acceptance criteria for the feature'),
  implementation: z
    .object({
      location: z.string().optional().describe('Where in the codebase this should be implemented'),
      dependencies: z.array(z.string()).optional().describe('Required dependencies or integrations'),
      edgeCases: z.array(z.string()).optional().describe('Edge cases to consider'),
    })
    // Optional like everything else here: half way through an interview the interviewer may
    // know nothing about the implementation yet, and a required object failed the whole run
    // on a reply that was otherwise a perfectly good next question.
    .optional()
    .describe('Implementation details'),
  isComplete: z.boolean().optional().describe('Whether all requirements have been gathered'),
});

// Define workflow state schema for strong typing
const workflowStateSchema = z
  .object({
    initialRequest: z.string(),
    repository: z.string(),
    owner: z.string(),
    issueNumber: z.number().optional(),
    issueUrl: z.string().optional(),
    conversationHistory: z.array(
      z.object({ role: z.enum(['user', 'assistant', 'system', 'tool']), content: z.string() }),
    ),
    // What was asked and what the user said, pair by pair. The interviewer's own summary is
    // what the requirements are built from, but it is a paraphrase; this is the record the
    // issue carries, so the session implementing it can read the user's actual words.
    interview: z.array(z.object({ question: z.string(), answer: z.string() })),
    response: z
      .object({
        needsMoreQuestions: z.boolean(),
        nextQuestion: z.string().optional(),
        requirements: gatheredRequirementsSchema,
      })
      .nullable(),
    success: z.boolean().optional(),
    message: z.string().optional(),
  })
  .partial();

// Schema for iterative questioning response
const questioningResponseSchema = z.object({
  needsMoreQuestions: z.boolean().describe('Whether more questions need to be asked'),
  nextQuestion: z.string().optional().describe('The next question to ask; left out once no more are needed'),
  requirements: gatheredRequirementsSchema.describe('Current state of gathered requirements'),
});

// Step 1: Initialize requirements gathering session using workflow state
const initializeGatheringSession = createStep({
  id: 'initialize-gathering-session',
  description: 'Sets up the initial prompt for requirements gathering',
  stateSchema: workflowStateSchema,
  inputSchema: requirementsInputSchema,
  outputSchema: z.object({}),
  execute: async (params) => {
    const owner = params.inputData.owner || DEFAULT_OWNER;
    const repo = params.inputData.repository || DEFAULT_REPOSITORY;

    const initialPrompt = `You are conducting a requirements gathering session for this feature request:

"${params.inputData.initialRequest}"

The work is in the ${owner}/${repo} repository${repo === DEFAULT_REPOSITORY ? " — Jarvis's own codebase" : ''}. That is settled: do not ask which repository.

Start by asking your first clarifying question to understand what needs to be implemented.`;

    params.setState({
      initialRequest: params.inputData.initialRequest,
      repository: repo,
      owner,
      conversationHistory: [{ role: 'user', content: initialPrompt }],
    });

    return {};
  },
});

// Step 2: Interview the user, one question per suspension, until nothing is left to ask
const askRequirementsQuestion = createStep({
  id: 'ask-requirements-question',
  description: 'Asks clarifying questions one at a time using the Requirements Interviewer Agent',
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
    const agent = params.mastra?.getAgent('requirementsInterviewer');
    if (!agent) {
      throw new Error('Requirements Interviewer agent not found');
    }

    const state = params.state;

    // If we have resume data, add the user's answer to conversation history, and to the
    // transcript beside the question it answers -- which is the one this step last suspended
    // with, still in state from before the suspension.
    let conversationHistory = state.conversationHistory ?? [];
    let interview = state.interview ?? [];
    if (params.resumeData?.userAnswer) {
      conversationHistory = [
        ...conversationHistory,
        {
          role: 'user',
          content: params.resumeData.userAnswer,
        },
      ];
      interview = [
        ...interview,
        { question: state.response?.nextQuestion ?? '', answer: params.resumeData.userAnswer },
      ];
    }

    // Get agent response with structured output
    // Zod infers role as a union ('user' | 'assistant' | ...) which can't be narrowed to the
    // discriminated CoreMessageV4 union; cast to Mastra's own bundled v4 type
    const response = await agent.stream(conversationHistory as CoreMessageV4[], {
      structuredOutput: {
        schema: questioningResponseSchema,
      },
      toolChoice: 'none',
    });

    const currentResponse = await response.object;

    if (!currentResponse) {
      throw new Error('Agent failed to provide a valid response');
    }

    // Add agent response to history
    const updatedHistory: typeof conversationHistory = [
      ...conversationHistory,
      {
        role: 'assistant' as const,
        content: JSON.stringify(currentResponse),
      },
    ];

    // Update workflow state with latest conversation and response
    params.setState({
      ...state,
      conversationHistory: updatedHistory,
      interview,
      response: currentResponse,
    });

    // If more questions needed, suspend the workflow to wait for human input
    if (currentResponse.needsMoreQuestions) {
      if (!currentResponse.nextQuestion) {
        throw new Error('Agent indicated more questions needed but did not provide a question');
      }

      // Suspend the workflow until the user answers. When the coding agent runs this as a
      // tool, the suspension travels up through the agent to the routing plan, which hands
      // the question to Jarvis to ask aloud and resumes this run with the answer -- see
      // `verticals/routing/controller.ts`.
      return await params.suspend({
        question: currentResponse.nextQuestion,
        context: `Gathering the requirements for: ${state.initialRequest}`,
      });
    }

    return {};
  },
});

// Step 3: Prepare issue creation data using workflow state
const prepareIssueCreationData = createStep({
  id: 'prepare-issue-creation-data',
  description: 'Prepares data for creating the issue with complete requirements',
  stateSchema: workflowStateSchema,
  inputSchema: z.object({}),
  outputSchema: z.object({
    owner: z.string().optional(),
    repo: z.string(),
    title: z.string(),
    body: z.string(),
    labels: z.array(z.string()).optional(),
  }),
  execute: async (params) => {
    const state = params.state;
    const requirements = state.response?.requirements;

    if (!requirements) {
      throw new Error('No requirements found in workflow state');
    }

    // Format requirements as markdown
    const requirementsList = requirements.requirements ?? [];
    const acceptanceCriteriaList = requirements.acceptanceCriteria ?? [];
    const implementation = requirements.implementation;
    const dependencies = implementation?.dependencies ?? [];
    const edgeCases = implementation?.edgeCases ?? [];

    const requirementsSection = requirementsList.map((requirement: string) => `- ${requirement}`).join('\n');
    const acceptanceCriteriaSection = acceptanceCriteriaList
      .map((criterion: string) => `- [ ] ${criterion}`)
      .join('\n');
    const implementationSection = `
**Location**: ${implementation?.location ?? 'Not specified'}

**Dependencies**:
${dependencies.map((dependency: string) => `- ${dependency}`).join('\n') || '- None'}

**Edge Cases**:
${edgeCases.map((edgeCase: string) => `- ${edgeCase}`).join('\n') || '- None'}
`;

    const discussionSection =
      (state.interview ?? [])
        .map(({ question, answer }, index) => `**Q${index + 1}**: ${question}\n\n**A${index + 1}**: ${answer}`)
        .join('\n\n') || 'No questions were needed.';

    const finalBody = `## Request
${state.initialRequest ?? ''}

## Requirements
${requirementsSection}

## Acceptance Criteria
${acceptanceCriteriaSection}

## Implementation Details
${implementationSection}

## Discussion History
${discussionSection}
`;

    return {
      owner: state.owner,
      repo: state.repository ?? DEFAULT_REPOSITORY,
      title: requirements.title ?? 'Feature Implementation',
      body: finalBody,
      labels: ['ready', 'requirements-complete'],
    };
  },
});

// Step 4: Create issue with requirements using tool
const createIssueWithRequirementsTool = createToolStep({
  id: 'create-issue-with-requirements-tool',
  description: 'Creates the issue with requirements using the GitHub API',
  stateSchema: workflowStateSchema,
  tool: createGitHubIssue,
});

// Schema for issue creation tool output - validated at runtime since .then() chain passes unknown
const issueCreationResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  issue_number: z.number().optional(),
  issue_url: z.string().optional(),
});

// Step 5: Store issue creation result in workflow state
const storeIssueCreationResult = createStep({
  id: 'store-issue-creation-result',
  description: 'Stores the issue creation result in workflow state',
  stateSchema: workflowStateSchema,
  inputSchema: z.unknown(),
  outputSchema: z.object({}),
  execute: async (params) => {
    const input = issueCreationResultSchema.parse(params.inputData);
    if (!input.success || !input.issue_number || !input.issue_url) {
      throw new Error(`Failed to create issue: ${input.message}`);
    }

    const state = params.state;
    params.setState({
      ...state,
      issueNumber: input.issue_number,
      issueUrl: input.issue_url,
      success: input.success,
      message: input.message,
    });
    return {};
  },
});

// Step 6: Validate success before starting the coding session
const validateBeforeCodingSession = createStep({
  id: 'validate-before-coding-session',
  description: 'Validates that issue creation succeeded before starting a Claude cloud session',
  stateSchema: workflowStateSchema,
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  execute: async (params) => {
    const state = params.state;

    if (!state.success) {
      throw new Error('Cannot start a Claude cloud session: Issue creation failed');
    }

    return {};
  },
});

// Step 7: Prepare Claude cloud session data using workflow state
const prepareCodingSessionData = createStep({
  id: 'prepare-coding-session-data',
  description: 'Prepares data for starting a Claude cloud session on the issue',
  stateSchema: workflowStateSchema,
  inputSchema: z.object({}),
  outputSchema: z.object({
    owner: z.string().optional(),
    repo: z.string(),
    issue_number: z.number(),
    title: z.string().optional(),
    instructions: z.string().optional(),
  }),
  execute: async (params) => {
    const state = params.state;

    if (!state.repository || !state.issueNumber) {
      throw new Error('Missing repository or issue number in workflow state');
    }

    const requirements = state.response?.requirements;

    return {
      owner: state.owner,
      repo: state.repository,
      issue_number: state.issueNumber,
      title: requirements?.title,
      instructions: (requirements?.requirements ?? []).map((requirement) => `- ${requirement}`).join('\n') || undefined,
    };
  },
});

// Step 8: Start the Claude cloud session that implements the issue
const startCodingSessionTool = createToolStep({
  id: 'start-coding-session-tool',
  description: 'Starts a Claude cloud session that implements the issue',
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

// Step 9: Format final workflow output
const formatFinalOutput = createStep({
  id: 'format-final-output',
  description: 'Formats the final workflow output with success message',
  stateSchema: workflowStateSchema,
  inputSchema: z.unknown(),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    issueUrl: z.string().optional(),
    sessionId: z.string().optional(),
    sessionUrl: z.string().optional(),
  }),
  execute: async (params) => {
    const input = codingSessionResultSchema.parse(params.inputData);
    const state = params.state;

    if (!input.success) {
      return {
        success: false,
        message: `Issue #${state.issueNumber} was created, but the Claude cloud session did not start: ${input.message}`,
        issueUrl: state.issueUrl,
      };
    }

    return {
      success: true,
      message: `Started a Claude cloud session on issue #${state.issueNumber}. ${input.message}`,
      issueUrl: state.issueUrl,
      sessionId: input.session_id,
      sessionUrl: input.session_url,
    };
  },
});

/**
 * Workflow for gathering requirements and creating implementation issues
 *
 * This workflow implements the requirements gathering pattern using workflow state:
 * 1. Initializes the requirements gathering session
 * 2. Asks clarifying questions via the Requirements Interviewer Agent, suspending on each
 *    one until the user answers it
 * 3. Prepares and creates the issue with complete requirements (3 sub-steps)
 * 4. Validates success before starting the implementation
 * 5. Starts a Claude cloud session that implements the issue (2 sub-steps)
 *
 * The session's events are watched from the moment it starts and republished as
 * Synapse state changes, so its progress reaches the notification system without
 * the workflow having to stay alive for the duration of the implementation.
 *
 * All state is managed via workflow.state and workflow.setState for cleaner code.
 * Tool calls are isolated in dedicated createToolStep steps for better observability.
 */
export const implementFeatureWorkflow = createWorkflow({
  id: 'implementFeatureWorkflow',
  stateSchema: workflowStateSchema,
  inputSchema: requirementsInputSchema,
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    issueUrl: z.string().optional(),
    sessionId: z.string().optional(),
    sessionUrl: z.string().optional(),
  }),
})
  .then(initializeGatheringSession)
  // Not a loop: the step asks, suspends, and is resumed with the answer as many times as the
  // interview takes, and only returns once there is nothing left to ask. It used to sit in a
  // `.dowhile` whose condition was always `true`, which meant a finished interview was run
  // again -- fifty times, until "exceeded maximum iterations" failed the run after the user
  // had answered everything and before the issue was filed.
  .then(askRequirementsQuestion)
  .then(prepareIssueCreationData)
  .then(createIssueWithRequirementsTool)
  .then(storeIssueCreationResult)
  .then(validateBeforeCodingSession)
  .then(prepareCodingSessionData)
  .then(startCodingSessionTool)
  .then(formatFinalOutput)
  .commit();
