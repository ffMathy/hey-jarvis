import type { MessageInput } from '@mastra/core/agent/message-list';
import { z } from 'zod';
import { createStep, createToolStep, createWorkflow } from '../../utils/workflows/workflow-factory.js';
import { assignCopilotToIssue, createGitHubIssue } from './tools.js';

// Schema for requirements gathering input
const requirementsInputSchema = z.object({
  initialRequest: z.string().describe('The initial feature/implementation request from the user'),
  repository: z.string().optional().describe('The repository name (defaults to "hey-jarvis")'),
  owner: z.string().optional().describe('The repository owner (defaults to "ffMathy")'),
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
    .describe('Implementation details'),
  questionsAsked: z.array(z.string()).optional().describe('List of questions asked during requirements gathering'),
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
    conversationHistory: z.array(z.any()),
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
  nextQuestion: z.string().optional().describe('The next question to ask, or null if complete'),
  requirements: gatheredRequirementsSchema.describe('Current state of gathered requirements'),
});

// Step 1: Initialize requirements gathering session using workflow state
const initializeGatheringSession = createStep({
  id: 'initialize-gathering-session',
  description: 'Sets up the initial prompt for requirements gathering',
  inputSchema: requirementsInputSchema,
  outputSchema: z.object({}),
  execute: async (params) => {
    const owner = params.inputData.owner || 'ffMathy';
    const repo = params.inputData.repository || 'hey-jarvis';

    const initialPrompt = `You are conducting a requirements gathering session for this feature request:

"${params.inputData.initialRequest}"

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

// Step 2: Ask a single question in the requirements gathering loop using workflow state
const askRequirementsQuestion = createStep({
  id: 'ask-requirements-question',
  description: 'Asks a single clarifying question using the Requirements Interviewer Agent',
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

    // If we have resume data, add the user's answer to conversation history
    let conversationHistory = state.conversationHistory ?? [];
    if (params.resumeData?.userAnswer) {
      conversationHistory = [
        ...conversationHistory,
        {
          role: 'user',
          content: params.resumeData.userAnswer,
        },
      ];
    }

    // Get agent response with structured output
    const response = await agent.stream(conversationHistory as MessageInput[], {
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
    const updatedHistory = [
      ...conversationHistory,
      {
        role: 'assistant',
        content: JSON.stringify(currentResponse),
      } as MessageInput,
    ];

    // Update workflow state with latest conversation and response
    params.setState({
      ...state,
      conversationHistory: updatedHistory,
      response: currentResponse,
    });

    // If more questions needed, suspend the workflow to wait for human input
    if (currentResponse.needsMoreQuestions) {
      if (!currentResponse.nextQuestion) {
        throw new Error('Agent indicated more questions needed but did not provide a question');
      }

      // Suspend the workflow with context for the UI
      return await params.suspend({
        question: currentResponse.nextQuestion,
        context: 'Requirements gathering in progress. Please provide your answer to continue.',
      });
    }

    return {};
  },
});

// Step 3: Prepare issue creation data using workflow state
const prepareIssueCreationData = createStep({
  id: 'prepare-issue-creation-data',
  description: 'Prepares data for creating the issue with complete requirements',
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
    const questionsAsked = requirements.questionsAsked ?? [];

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

    const discussionSection = questionsAsked
      .map((question: string, index: number) => `**Q${index + 1}**: ${question}`)
      .join('\n\n');

    const finalBody = `## Requirements
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
      repo: state.repository ?? 'hey-jarvis',
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
  tool: createGitHubIssue,
});

// Step 5: Store issue creation result in workflow state
const storeIssueCreationResult = createStep({
  id: 'store-issue-creation-result',
  description: 'Stores the issue creation result in workflow state',
  inputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    issue_number: z.number().optional(),
    issue_url: z.string().optional(),
  }),
  outputSchema: z.object({}),
  execute: async (params) => {
    if (!params.inputData.success || !params.inputData.issue_number || !params.inputData.issue_url) {
      throw new Error(`Failed to create issue: ${params.inputData.message}`);
    }

    const state = params.state;
    params.setState({
      ...state,
      issueNumber: params.inputData.issue_number,
      issueUrl: params.inputData.issue_url,
      success: params.inputData.success,
      message: params.inputData.message,
    });
    return {};
  },
});

// Step 6: Validate success before Copilot assignment
const validateBeforeCopilotAssignment = createStep({
  id: 'validate-before-copilot-assignment',
  description: 'Validates that issue update succeeded before assigning Copilot',
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  execute: async (params) => {
    const state = params.state;

    if (!state.success) {
      throw new Error('Cannot assign to Copilot: Issue update failed');
    }

    return {};
  },
});

// Step 7: Prepare Copilot assignment data using workflow state
const prepareCopilotAssignmentData = createStep({
  id: 'prepare-copilot-assignment-data',
  description: 'Prepares data for assigning the issue to Copilot',
  inputSchema: z.object({}),
  outputSchema: z.object({
    owner: z.string().optional(),
    repo: z.string(),
    issue_number: z.number(),
  }),
  execute: async (params) => {
    const state = params.state;

    if (!state.repository || !state.issueNumber) {
      throw new Error('Missing repository or issue number in workflow state');
    }

    return {
      owner: state.owner,
      repo: state.repository,
      issue_number: state.issueNumber,
    };
  },
});

// Step 8: Assign to GitHub Copilot using tool
const assignToCopilotTool = createToolStep({
  id: 'assign-to-copilot-tool',
  description: 'Assigns the issue to Copilot using the GitHub API',
  tool: assignCopilotToIssue,
});

// Step 9: Format final workflow output
const formatFinalOutput = createStep({
  id: 'format-final-output',
  description: 'Formats the final workflow output with success message',
  inputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    task_url: z.string().optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    issueUrl: z.string().optional(),
  }),
  execute: async (params) => {
    const state = params.state;

    if (!params.inputData.success) {
      return {
        success: false,
        message: `Copilot assignment initiated but may require manual confirmation: ${params.inputData.message}`,
        issueUrl: state.issueUrl,
      };
    }

    return {
      success: true,
      message: `Successfully assigned Copilot to issue #${state.issueNumber}. ${params.inputData.message}`,
      issueUrl: state.issueUrl,
    };
  },
});

/**
 * Workflow for gathering requirements and creating implementation issues
 *
 * This workflow implements the requirements gathering pattern using workflow state:
 * 1. Initializes the requirements gathering session
 * 2. Uses Mastra's .dowhile() to iteratively:
 *    a. Ask clarifying questions via Requirements Interviewer Agent
 * 3. Prepares and creates the issue with complete requirements (3 sub-steps)
 * 4. Validates success before Copilot assignment
 * 5. Prepares and assigns GitHub Copilot for implementation (3 sub-steps)
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
  }),
})
  .then(initializeGatheringSession)
  .dowhile(askRequirementsQuestion, async ({ iterationCount }) => {
    // Safety limit check
    if (iterationCount >= 50) {
      throw new Error('Requirements gathering exceeded maximum iterations');
    }

    // Note: We can't access workflow.state in dowhile condition
    // The loop will naturally exit when suspend() is not called
    // which happens when needsMoreQuestions is false
    return true;
  })
  .then(prepareIssueCreationData)
  .then(createIssueWithRequirementsTool)
  .then(storeIssueCreationResult)
  .then(validateBeforeCopilotAssignment)
  .then(prepareCopilotAssignmentData)
  .then(assignToCopilotTool)
  .then(formatFinalOutput)
  .commit();
